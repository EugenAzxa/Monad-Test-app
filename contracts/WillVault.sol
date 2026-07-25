// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WillVault
 * @notice A tamper-proof digital vault for wills, deeds, and important documents,
 *         built for the Monad Blitz hackathon.
 *
 * Two novel mechanics combined:
 *
 *  1) NOTARIZATION ("can't be stolen or secretly altered")
 *     Anyone can register the keccak256 hash of a document. The hash + author +
 *     timestamp are stored immutably. Later, anyone can PROVE a given file is the
 *     exact one that was registered at time T by that author — a single changed
 *     byte produces a different hash, so tampering is detectable forever.
 *
 *  2) DEAD-MAN'S SWITCH INHERITANCE ("in case they die")
 *     A testator creates a Vault, adds encrypted document references, names heirs,
 *     and periodically "checks in" (proof of life). If they stop checking in for
 *     longer than their chosen interval, the vault is considered RELEASED and the
 *     named heirs can claim access to the encrypted keys left for them.
 *
 * IMPORTANT SECURITY NOTE ON PRIVACY:
 *   All storage on a public blockchain is world-readable. This contract NEVER
 *   stores plaintext documents or plaintext keys. Documents are encrypted client
 *   side (AES-GCM) before their reference is stored, and each heir's decryption
 *   key is wrapped to that heir's public key (ECDH) off-chain before being placed
 *   here. The dead-man's switch is therefore an ACCESS-CONTROL & UX gate on top of
 *   cryptography that already protects the data — not the sole line of defense.
 */
contract WillVault {
    // ----------------------------------------------------------------------
    // 1) NOTARIZATION
    // ----------------------------------------------------------------------

    struct Notarization {
        address author;
        uint64  timestamp;
        string  title;
        string  category; // e.g. "will", "deed", "insurance"
    }

    // documentHash => notarization record
    mapping(bytes32 => Notarization) public notarizations;

    event DocumentNotarized(
        bytes32 indexed documentHash,
        address indexed author,
        string  title,
        string  category,
        uint64  timestamp
    );

    /**
     * @notice Register the hash of a document to prove it existed, unaltered,
     *         at this moment and was submitted by msg.sender.
     * @param documentHash keccak256 of the document's raw bytes (computed client-side).
     */
    function notarize(bytes32 documentHash, string calldata title, string calldata category) external {
        require(documentHash != bytes32(0), "empty hash");
        require(notarizations[documentHash].timestamp == 0, "already notarized");

        notarizations[documentHash] = Notarization({
            author: msg.sender,
            timestamp: uint64(block.timestamp),
            title: title,
            category: category
        });

        emit DocumentNotarized(documentHash, msg.sender, title, category, uint64(block.timestamp));
    }

    /**
     * @notice Verify a document. Returns whether the hash is on record, and by whom / when.
     */
    function verify(bytes32 documentHash)
        external
        view
        returns (bool exists, address author, uint64 timestamp, string memory title, string memory category)
    {
        Notarization memory n = notarizations[documentHash];
        exists = n.timestamp != 0;
        return (exists, n.author, n.timestamp, n.title, n.category);
    }

    // ----------------------------------------------------------------------
    // 2) DEAD-MAN'S SWITCH VAULT
    // ----------------------------------------------------------------------

    struct Document {
        bytes32 documentHash; // notarization anchor (keccak256 of plaintext)
        string  title;
        string  category;
        string  encryptedURI; // IPFS CID or data-URI of the AES-GCM ciphertext
        uint64  addedAt;
    }

    struct Heir {
        bool    exists;
        bool    claimed;
        string  wrappedKey;      // AES key wrapped to the heir's public key (ECDH-derived)
        string  ephemeralPubKey; // sender's ephemeral public key needed to unwrap
    }

    struct Vault {
        bool    exists;
        uint64  checkInInterval; // seconds of silence after which heirs may claim
        uint64  lastCheckIn;     // last proof-of-life timestamp
        bool    releasedManually; // testator can trigger release early (e.g. terminal)
        address[] heirList;
    }

    mapping(address => Vault) private vaults;                    // owner => vault
    mapping(address => Document[]) private vaultDocuments;       // owner => docs
    mapping(address => mapping(address => Heir)) private heirs;  // owner => heir => data

    event VaultCreated(address indexed owner, uint64 checkInInterval);
    event CheckedIn(address indexed owner, uint64 timestamp, uint64 nextDeadline);
    event IntervalUpdated(address indexed owner, uint64 checkInInterval);
    event DocumentAdded(address indexed owner, bytes32 indexed documentHash, string title);
    event HeirAdded(address indexed owner, address indexed heir);
    event HeirRemoved(address indexed owner, address indexed heir);
    event ManuallyReleased(address indexed owner, uint64 timestamp);
    event VaultClaimed(address indexed owner, address indexed heir, uint64 timestamp);

    // ----------------------------------------------------------------------
    // 3) ENDOWMENT (yield-bearing inheritance / insurance payout) + $LEGACY
    // ----------------------------------------------------------------------

    mapping(address => uint256) public endowment;      // MON principal deposited by an owner, held for heirs
    mapping(address => uint64)  public endowmentSince; // when the deposit started (for projected yield)
    uint256 public totalValueLocked;                   // total MON held across all vaults

    // $LEGACY: the ecosystem's economic unit. Non-transferable reward points in this
    // prototype (production = ERC-20 with utility). Earned by engaging with the protocol,
    // so the supply and participant count grow as the community grows.
    mapping(address => uint256) public legacyBalance;  // $LEGACY earned per user
    uint256 public legacySupply;                       // total $LEGACY minted (grows with engagement)
    uint256 public participants;                       // unique addresses that have earned $LEGACY
    uint16  public constant YIELD_BPS = 800;           // 8.00% APR, illustrative projection for the UI

    event Deposited(address indexed owner, uint256 amount, uint256 newPrincipal);
    event EndowmentWithdrawn(address indexed owner, uint256 amount);
    event EndowmentPaid(address indexed owner, address indexed heir, uint256 amount);
    event LegacyEarned(address indexed user, uint256 amount, string reason);

    /// @dev Mint $LEGACY to a user for engaging; grows the ecosystem's economic unit.
    function _award(address user, uint256 amount, string memory reason) internal {
        if (amount == 0) return;
        if (legacyBalance[user] == 0) participants++;
        legacyBalance[user] += amount;
        legacySupply += amount;
        emit LegacyEarned(user, amount, reason);
    }

    modifier hasVault(address owner) {
        require(vaults[owner].exists, "no vault");
        _;
    }

    /**
     * @notice Create your vault and start the dead-man's switch.
     * @param checkInInterval Seconds you may stay silent before heirs can claim.
     *        (Use a small value like 60 for a live demo; large value in production.)
     */
    function createVault(uint64 checkInInterval) external {
        require(!vaults[msg.sender].exists, "vault exists");
        require(checkInInterval > 0, "interval=0");

        Vault storage v = vaults[msg.sender];
        v.exists = true;
        v.checkInInterval = checkInInterval;
        v.lastCheckIn = uint64(block.timestamp);

        emit VaultCreated(msg.sender, checkInInterval);
        emit CheckedIn(msg.sender, uint64(block.timestamp), uint64(block.timestamp) + checkInInterval);
        _award(msg.sender, 100, "create vault");
    }

    /// @notice Proof of life. Resets the countdown. Call this regularly to stay "alive".
    function checkIn() external hasVault(msg.sender) {
        Vault storage v = vaults[msg.sender];
        require(!v.releasedManually, "already released");
        v.lastCheckIn = uint64(block.timestamp);
        emit CheckedIn(msg.sender, uint64(block.timestamp), uint64(block.timestamp) + v.checkInInterval);
        _award(msg.sender, 10, "check in");
    }

    /**
     * @notice Deposit MON into your vault as an endowment. It stays yours (withdrawable
     *         any time before release) and is paid to the first heir who claims after
     *         release - a will that doubles as a life-insurance payout. Earns $LEGACY.
     */
    function deposit() external payable hasVault(msg.sender) {
        require(msg.value > 0, "no value");
        if (endowment[msg.sender] == 0) endowmentSince[msg.sender] = uint64(block.timestamp);
        endowment[msg.sender] += msg.value;
        totalValueLocked += msg.value;
        _award(msg.sender, 30 + (msg.value / 1e16), "deposit"); // base + scaled with size
        emit Deposited(msg.sender, msg.value, endowment[msg.sender]);
    }

    /// @notice Withdraw your endowment (only before the vault releases).
    function withdrawEndowment() external hasVault(msg.sender) {
        require(!isReleased(msg.sender), "released");
        uint256 amount = endowment[msg.sender];
        require(amount > 0, "nothing to withdraw");
        endowment[msg.sender] = 0;
        endowmentSince[msg.sender] = 0;
        totalValueLocked -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit EndowmentWithdrawn(msg.sender, amount);
    }

    /// @notice Change how long you may stay silent before release.
    function setCheckInInterval(uint64 checkInInterval) external hasVault(msg.sender) {
        require(checkInInterval > 0, "interval=0");
        vaults[msg.sender].checkInInterval = checkInInterval;
        emit IntervalUpdated(msg.sender, checkInInterval);
    }

    /// @notice Immediately release the vault to heirs (e.g. terminal diagnosis).
    function releaseNow() external hasVault(msg.sender) {
        vaults[msg.sender].releasedManually = true;
        emit ManuallyReleased(msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Add an encrypted document reference to your vault. Also notarizes the
     *         plaintext hash if it hasn't been notarized yet.
     * @param documentHash keccak256 of the plaintext document.
     * @param encryptedURI  IPFS CID / data URI of the AES-GCM ciphertext.
     */
    function addDocument(
        bytes32 documentHash,
        string calldata title,
        string calldata category,
        string calldata encryptedURI
    ) external hasVault(msg.sender) {
        vaultDocuments[msg.sender].push(Document({
            documentHash: documentHash,
            title: title,
            category: category,
            encryptedURI: encryptedURI,
            addedAt: uint64(block.timestamp)
        }));

        // Opportunistically notarize so existence/authorship is provable.
        if (documentHash != bytes32(0) && notarizations[documentHash].timestamp == 0) {
            notarizations[documentHash] = Notarization({
                author: msg.sender,
                timestamp: uint64(block.timestamp),
                title: title,
                category: category
            });
            emit DocumentNotarized(documentHash, msg.sender, title, category, uint64(block.timestamp));
        }

        emit DocumentAdded(msg.sender, documentHash, title);
        _award(msg.sender, 25, "add document");
    }

    /**
     * @notice Name an heir and leave them the wrapped key material they'll need
     *         to decrypt your documents once the vault releases.
     * @param heir            heir's wallet address.
     * @param wrappedKey      AES key encrypted to the heir's public key.
     * @param ephemeralPubKey ephemeral public key used in the ECDH wrap.
     */
    function addHeir(
        address heir,
        string calldata wrappedKey,
        string calldata ephemeralPubKey
    ) external hasVault(msg.sender) {
        require(heir != address(0), "zero heir");
        Heir storage h = heirs[msg.sender][heir];
        if (!h.exists) {
            h.exists = true;
            vaults[msg.sender].heirList.push(heir);
        }
        h.wrappedKey = wrappedKey;
        h.ephemeralPubKey = ephemeralPubKey;
        emit HeirAdded(msg.sender, heir);
        _award(msg.sender, 50, "add heir");
    }

    /// @notice Remove an heir before release.
    function removeHeir(address heir) external hasVault(msg.sender) {
        Heir storage h = heirs[msg.sender][heir];
        require(h.exists, "not an heir");
        require(!isReleased(msg.sender), "already released");
        h.exists = false;
        h.wrappedKey = "";
        h.ephemeralPubKey = "";

        address[] storage list = vaults[msg.sender].heirList;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == heir) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        emit HeirRemoved(msg.sender, heir);
    }

    /**
     * @notice Has this owner's dead-man's switch tripped?
     *         True if manually released OR silent for longer than the interval.
     */
    function isReleased(address owner) public view returns (bool) {
        Vault storage v = vaults[owner];
        if (!v.exists) return false;
        if (v.releasedManually) return true;
        return block.timestamp > uint256(v.lastCheckIn) + uint256(v.checkInInterval);
    }

    /// @notice Seconds remaining before release (0 if already released).
    function timeRemaining(address owner) external view returns (uint256) {
        Vault storage v = vaults[owner];
        if (!v.exists || v.releasedManually) return 0;
        uint256 deadline = uint256(v.lastCheckIn) + uint256(v.checkInInterval);
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }

    /**
     * @notice Heir claims the vault after release. Emits an on-chain, permanent
     *         record that this heir accessed the estate.
     */
    function claim(address owner) external hasVault(owner) {
        require(isReleased(owner), "not released yet");
        Heir storage h = heirs[owner][msg.sender];
        require(h.exists, "not an heir");
        h.claimed = true;
        emit VaultClaimed(owner, msg.sender, uint64(block.timestamp));
        _award(msg.sender, 40, "claim inheritance");

        // Life-insurance payout: the first heir to claim receives the endowment.
        uint256 payout = endowment[owner];
        if (payout > 0) {
            endowment[owner] = 0;
            endowmentSince[owner] = 0;
            totalValueLocked -= payout;
            (bool ok, ) = payable(msg.sender).call{value: payout}("");
            require(ok, "payout failed");
            emit EndowmentPaid(owner, msg.sender, payout);
        }
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function getVaultInfo(address owner)
        external
        view
        returns (
            bool exists,
            uint64 checkInInterval,
            uint64 lastCheckIn,
            bool releasedManually,
            bool released,
            uint256 docCount,
            uint256 heirCount
        )
    {
        Vault storage v = vaults[owner];
        return (
            v.exists,
            v.checkInInterval,
            v.lastCheckIn,
            v.releasedManually,
            isReleased(owner),
            vaultDocuments[owner].length,
            v.heirList.length
        );
    }

    function getDocuments(address owner) external view returns (Document[] memory) {
        return vaultDocuments[owner];
    }

    function getHeirs(address owner) external view returns (address[] memory) {
        return vaults[owner].heirList;
    }

    /**
     * @notice Retrieve the key material left for the caller by `owner`.
     *         Reverts until the vault is released — the dead-man's-switch gate.
     */
    function getMyKeyMaterial(address owner)
        external
        view
        returns (string memory wrappedKey, string memory ephemeralPubKey)
    {
        require(isReleased(owner), "not released yet");
        Heir storage h = heirs[owner][msg.sender];
        require(h.exists, "not an heir");
        return (h.wrappedKey, h.ephemeralPubKey);
    }

    /// @notice Whether a given address is a named heir of an owner.
    function isHeir(address owner, address heir) external view returns (bool) {
        return heirs[owner][heir].exists;
    }

    /**
     * @notice Endowment info for an owner: deposited principal, deposit time, and the
     *         8% APR projected value right now (illustrative - the contract holds the
     *         principal; production routes it into a yield protocol so it truly grows).
     */
    function getEndowment(address owner)
        external
        view
        returns (uint256 principal, uint64 since, uint256 projectedValue)
    {
        principal = endowment[owner];
        since = endowmentSince[owner];
        projectedValue = principal;
        if (principal > 0 && since > 0 && block.timestamp > since) {
            uint256 elapsed = block.timestamp - since;
            projectedValue = principal + (principal * YIELD_BPS * elapsed) / (10000 * 365 days);
        }
    }

    /// @notice Ecosystem snapshot for the UI: how the economic unit is growing.
    function ecosystem()
        external
        view
        returns (uint256 tvl, uint256 legacyMinted, uint256 numParticipants)
    {
        return (totalValueLocked, legacySupply, participants);
    }
}
