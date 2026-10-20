// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/*
 * Personal deposit addresses that move USDC to a fixed Stellar wallet through Circle CCTP V2.
 *
 * Each BlockFinaX user gets one deposit address: an EIP-1167 clone of StellarDeposit, created by
 * the factory with CREATE2 and salt = keccak256(Stellar wallet). The address is known before it
 * exists and commits to that wallet: only the factory can create it, and the factory sets the
 * wallet in the same transaction. Money sent to it can only ever leave one way: burned by
 * Circle's TokenMessengerV2 with Circle's Stellar CctpForwarder as recipient and the user's wallet
 * in the hook, so Circle mints it to them.
 *
 * Safety properties
 *  - Only the canonical USDC fixed in the factory is ever read or moved. Any other token sent
 *    here (a fake "USDC" included) is ignored: no function can move it, and it is never credited.
 *  - The destination is fixed at creation. No owner, no admin, no way to change it.
 *  - Anyone may call flush: it can only send the user's own USDC to the user's own wallet.
 *  - The fee a caller may offer Circle is capped by the factory (maxFeeBps of the amount), so a
 *    caller cannot burn a deposit into fees.
 *  - Amounts below minAmount are left until more arrives, so dust cannot be used to waste gas.
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface ITokenMessengerV2 {
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

/// The logic every deposit address runs (through its clone).
contract StellarDeposit {
    /// Set once, by the factory, in the transaction that creates the clone.
    StellarDepositFactory public factory;
    bytes public hookData;

    event Flushed(uint256 amount, uint256 maxFee, uint32 minFinalityThreshold);

    constructor() {
        // The implementation itself is never a deposit address: lock it.
        factory = StellarDepositFactory(address(1));
    }

    function initialize(bytes calldata hook) external {
        require(address(factory) == address(0), "initialized");
        factory = StellarDepositFactory(msg.sender);
        hookData = hook;
    }

    /// Send every unit of USDC held here to the recipient's Stellar wallet through CCTP.
    function flush(uint256 maxFee, uint32 minFinalityThreshold) external returns (uint256 amount) {
        StellarDepositFactory f = factory;
        require(address(f) != address(0) && address(f) != address(1), "not a deposit address");
        IERC20 usdc = IERC20(f.usdc());
        amount = usdc.balanceOf(address(this));
        require(amount >= f.minAmount(), "below minimum");
        require(maxFee * 10_000 <= amount * f.maxFeeBps(), "fee above cap");
        require(minFinalityThreshold == 1000 || minFinalityThreshold == 2000, "bad finality");
        address messenger = f.tokenMessenger();
        require(usdc.approve(messenger, amount), "approve failed");
        bytes32 forwarder = f.forwarder();
        ITokenMessengerV2(messenger).depositForBurnWithHook(
            amount, f.destinationDomain(), forwarder, address(usdc), forwarder, maxFee, minFinalityThreshold, hookData
        );
        emit Flushed(amount, maxFee, minFinalityThreshold);
    }
}

contract StellarDepositFactory {
    address public immutable implementation;
    address public immutable usdc;
    address public immutable tokenMessenger;
    /// Circle's CctpForwarder on Stellar: mint recipient and destination caller.
    bytes32 public immutable forwarder;
    uint32 public immutable destinationDomain;
    uint256 public immutable minAmount;
    uint256 public immutable maxFeeBps;

    event DepositCreated(address indexed deposit, string recipient);

    constructor(
        address implementation_,
        address usdc_,
        address tokenMessenger_,
        bytes32 forwarder_,
        uint32 destinationDomain_,
        uint256 minAmount_,
        uint256 maxFeeBps_
    ) {
        require(implementation_.code.length > 0, "no implementation");
        require(usdc_ != address(0) && tokenMessenger_ != address(0) && forwarder_ != bytes32(0), "zero config");
        require(maxFeeBps_ <= 100, "fee cap too high");
        implementation = implementation_;
        usdc = usdc_;
        tokenMessenger = tokenMessenger_;
        forwarder = forwarder_;
        destinationDomain = destinationDomain_;
        minAmount = minAmount_;
        maxFeeBps = maxFeeBps_;
    }

    /// The deposit address for a Stellar wallet, whether or not it exists yet.
    function addressFor(string calldata recipient) public view returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), keccak256(bytes(recipient)), keccak256(_cloneCode())));
        return address(uint160(uint256(hash)));
    }

    /// Create the deposit address if needed, then flush it. Anyone may call.
    function flush(string calldata recipient, uint256 maxFee, uint32 minFinalityThreshold) external returns (uint256) {
        address d = addressFor(recipient);
        if (d.code.length == 0) {
            bytes memory hook = hookFor(recipient);
            bytes memory code = _cloneCode();
            bytes32 salt = keccak256(bytes(recipient));
            address created;
            assembly {
                created := create2(0, add(code, 0x20), mload(code), salt)
            }
            require(created == d, "create failed");
            StellarDeposit(created).initialize(hook);
            emit DepositCreated(d, recipient);
        }
        return StellarDeposit(d).flush(maxFee, minFinalityThreshold);
    }

    /// CctpForwarder hook: 24 zero bytes, version 0, length, then the Stellar strkey.
    /// Rejects anything that is not a 56-character G or C strkey, because a malformed
    /// recipient would leave the minted USDC unrecoverable.
    function hookFor(string memory recipient) public pure returns (bytes memory) {
        bytes memory r = bytes(recipient);
        require(r.length == 56, "recipient length");
        require(r[0] == "C" || r[0] == "G", "recipient type");
        for (uint256 i = 0; i < 56; i++) {
            bytes1 c = r[i];
            require((c >= "A" && c <= "Z") || (c >= "2" && c <= "7"), "recipient charset");
        }
        return abi.encodePacked(bytes24(0), uint32(0), uint32(56), r);
    }

    /// EIP-1167 minimal proxy creation code pointing at the implementation.
    function _cloneCode() internal view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
