import {
  arrayify,
  defaultAbiCoder,
  keccak256,
  hexDataSlice,
} from "ethers/lib/utils";
import { ethers, BigNumber, Contract, Signer, Wallet } from "ethers";
import { AddressZero, callDataCost } from "./utils";
import {
  ecsign,
  toRpcSig,
  keccak256 as keccak256_buffer,
} from "ethereumjs-util";
import { UserOperation } from "./UserOperation";
import {
  EntryPoint,
  ERC1967Proxy__factory,
  Account__factory,
  AccountFactory,
} from "../typechain";

function encode(
  typevalues: Array<{ type: string; val: any }>,
  forSignature: boolean
): string {
  const types = typevalues.map((typevalue) =>
    typevalue.type === "bytes" && forSignature ? "bytes32" : typevalue.type
  );
  const values = typevalues.map((typevalue) =>
    typevalue.type === "bytes" && forSignature
      ? keccak256(typevalue.val)
      : typevalue.val
  );
  return defaultAbiCoder.encode(types, values);
}

export function packUserOp(op: UserOperation, forSignature = true): string {
  if (forSignature) {
    return defaultAbiCoder.encode(
      [
        "address",
        "uint256",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "bytes32",
      ],
      [
        op.sender,
        op.nonce,
        keccak256(op.initCode),
        keccak256(op.callData),
        op.callGasLimit,
        op.verificationGasLimit,
        op.preVerificationGas,
        op.maxFeePerGas,
        op.maxPriorityFeePerGas,
        keccak256(op.paymasterAndData),
      ]
    );
  } else {
    // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
    return defaultAbiCoder.encode(
      [
        "address",
        "uint256",
        "bytes",
        "bytes",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "bytes",
        "bytes",
      ],
      [
        op.sender,
        op.nonce,
        op.initCode,
        op.callData,
        op.callGasLimit,
        op.verificationGasLimit,
        op.preVerificationGas,
        op.maxFeePerGas,
        op.maxPriorityFeePerGas,
        op.paymasterAndData,
        op.signature,
      ]
    );
  }
}

export function rethrow(): (e: Error) => void {
  const callerStack = new Error()
    .stack!.replace(/Error.*\n.*at.*\n/, "")
    .replace(/.*at.* \(internal[\s\S]*/, "");

  if (arguments[0] != null) {
    throw new Error("must use .catch(rethrow()), and NOT .catch(rethrow)");
  }
  return function (e: Error) {
    const solstack = e.stack!.match(/((?:.* at .*\.sol.*\n)+)/);
    const stack = (solstack != null ? solstack[1] : "") + callerStack;
    // const regex = new RegExp('error=.*"data":"(.*?)"').compile()
    const found = /error=.*?"data":"(.*?)"/.exec(e.message);
    let message: string;
    if (found != null) {
      const data = found[1];
      message =
        decodeRevertReason(data) ?? e.message + " - " + data.slice(0, 100);
    } else {
      message = e.message;
    }
    const err = new Error(message);
    err.stack = "Error: " + message + "\n" + stack;
    throw err;
  };
}
export function decodeRevertReason(
  data: string,
  nullIfNoMatch = true
): string | null {
  const methodSig = data.slice(0, 10);
  const dataParams = "0x" + data.slice(10);

  if (methodSig === "0x08c379a0") {
    const [err] = ethers.utils.defaultAbiCoder.decode(["string"], dataParams);
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `Error(${err})`;
  } else if (methodSig === "0x00fa072b") {
    const [opindex, paymaster, msg] = ethers.utils.defaultAbiCoder.decode(
      ["uint256", "address", "string"],
      dataParams
    );
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `FailedOp(${opindex}, ${
      paymaster !== AddressZero ? paymaster : "none"
    }, ${msg})`;
  } else if (methodSig === "0x4e487b71") {
    const [code] = ethers.utils.defaultAbiCoder.decode(["uint256"], dataParams);
    return `Panic(${panicCodes[code] ?? code} + ')`;
  }
  if (!nullIfNoMatch) {
    return data;
  }
  return null;
}

const panicCodes: { [key: number]: string } = {
  // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
  0x01: "assert(false)",
  0x11: "arithmetic overflow/underflow",
  0x12: "divide by zero",
  0x21: "invalid enum value",
  0x22: "storage byte array that is incorrectly encoded",
  0x31: ".pop() on an empty array.",
  0x32: "array sout-of-bounds or negative index",
  0x41: "memory overflow",
  0x51: "zero-initialized variable of internal function type",
};

export function packUserOp1(op: UserOperation): string {
  return defaultAbiCoder.encode(
    [
      "address",
      "uint256",
      "bytes32",
      "bytes32",
      "uint256",
      "uint",
      "uint",
      "uint256",
      "uint256",
      "bytes32",
    ],
    [
      op.sender,
      op.nonce,
      keccak256(op.initCode),
      keccak256(op.callData),
      op.callGasLimit,
      op.verificationGasLimit,
      op.preVerificationGas,
      op.maxFeePerGas,
      op.maxPriorityFeePerGas,
      keccak256(op.paymasterAndData),
    ]
  );
}

export function getUserOpHash(
  op: UserOperation,
  entryPoint: string,
  chainId: number
): string {
  const userOpHash = keccak256(packUserOp(op, true));

  const enc = defaultAbiCoder.encode(
    ["bytes32", "address", "uint256"],
    [userOpHash, entryPoint, chainId]
  );
  return keccak256(enc);
}

export const DefaultsForUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  initCode: "0x",
  callData: "0x",
  callGasLimit: 0,
  verificationGasLimit: 100000,
  preVerificationGas: 21000,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 1e9,
  paymasterAndData: "0x",
  signature: "0x",
};

export function signUserOp(
  op: UserOperation,
  signer: Wallet,
  entryPoint: string,
  chainId: number
): UserOperation {
  const message = getUserOpHash(op, entryPoint, chainId);

  const msg = Buffer.concat([
    Buffer.from("\x19Ethereum Signed Message:\n32", "ascii"),
    Buffer.from(arrayify(message)),
  ]);

  const sig = ecsign(
    keccak256_buffer(msg),
    Buffer.from(arrayify(signer.privateKey))
  );

  const signedMessage = toRpcSig(sig.v, sig.r, sig.s);

  return {
    ...op,
    signature: signedMessage,
  };
}

export function fillUserOpDefault(
  op: Partial<UserOperation>,
  defaults = DefaultsForUserOp
): UserOperation {
  const partial: any = { ...op };
  for (const key in partial) {
    if (partial[key] == null) {
      delete partial[key];
    }
  }
  const filled = { ...defaults, ...partial };
  return filled;
}

export async function getDeployedAddress(
  accountFactory: AccountFactory,
  owner: string,
  salt: string
): Promise<string> {
  const encodedFunctionCall =
    Account__factory.createInterface().encodeFunctionData("initialize", [
      owner,
    ]);
  const encoder = new ethers.utils.AbiCoder();
  const initcodeHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["bytes", "bytes"],
      [
        ERC1967Proxy__factory.bytecode,
        encoder.encode(
          ["address", "bytes"],
          [await accountFactory.accountImplementation(), encodedFunctionCall]
        ),
      ]
    )
  );
  return ethers.utils.getCreate2Address(
    accountFactory.address,
    salt,
    initcodeHash
  );
}

export async function fillUserOp(
  accountFactory: AccountFactory,
  op: Partial<UserOperation>,
  entryPoint?: EntryPoint
): Promise<UserOperation> {
  const op1 = { ...op };
  const provider = entryPoint?.provider;

  if (op.initCode != null) {
    const initAddr = hexDataSlice(op1.initCode!, 0, 20);
    const initCallData = hexDataSlice(op1.initCode!, 20);
    if (op1.nonce == null) op1.nonce = 0;
    if (op1.sender == null) {
      if (initAddr.toLowerCase() === accountFactory.address.toLowerCase()) {
        const salt = hexDataSlice(initCallData, 0, 32);
        const ctr = hexDataSlice(initCallData, 32);
        op1.sender = await getDeployedAddress(accountFactory, ctr, salt);
      } else {
        if (provider == null) throw new Error("no EntryPoint/Provider");
        op1.sender = await entryPoint!.callStatic
          .getSenderAddress(op1.initCode!)
          .catch((e) => e.errorArgs.sender);
      }
    }

    if (op1.verificationGasLimit == null) {
      if (provider == null) throw new Error("no EntryPoint/Provider");
      const initEstimate = await provider.estimateGas({
        from: entryPoint?.address,
        to: initAddr,
        data: initCallData,
        gasLimit: 10e6,
      });
      op1.verificationGasLimit = BigNumber.from(
        DefaultsForUserOp.verificationGasLimit
      ).add(initEstimate);
    }
  }
  if (op1.nonce == null) {
    if (provider == null)
      throw new Error("must have entryPoint to autofill nonce");
    const c = new Contract(
      op.sender!,
      ["function nonce() view returns(uint256)"],
      provider
    );
    op1.nonce = await c.nonce().catch(rethrow());
  }

  if (op1.callGasLimit == null && op.callData != null) {
    if (provider == null)
      throw new Error("must have EntryPoint for callGasLimit estimate");
    const gasEstimated = await provider.estimateGas({
      from: entryPoint?.address,
      to: op1.sender,
      data: op1.callData,
    });

    op1.callGasLimit = gasEstimated;
  }
  if (op1.maxFeePerGas == null) {
    if (provider == null)
      throw new Error("must have EntryPoint to autofill maxFeePerGas");
    const block = await provider.getBlock("latest");
    op1.maxFeePerGas = block.baseFeePerGas!.add(
      op1.maxPriorityFeePerGas ?? DefaultsForUserOp.maxPriorityFeePerGas
    );
  }
  if (op1.maxPriorityFeePerGas == null) {
    op1.maxPriorityFeePerGas = DefaultsForUserOp.maxPriorityFeePerGas;
  }
  const op2 = fillUserOpDefault(op1);
  if (op2.preVerificationGas.toString() === "0") {
    op2.preVerificationGas = callDataCost(packUserOp(op2, false));
  }
  return op2;
}

export async function fillAndSign(
  accountFactory: AccountFactory,
  op: Partial<UserOperation>,
  signer: Wallet | Signer,
  entryPoint?: EntryPoint
): Promise<UserOperation> {
  const provider = entryPoint?.provider;
  const op2 = await fillUserOp(accountFactory, op, entryPoint);

  const chainId = await provider!.getNetwork().then((net) => net.chainId);
  const message = arrayify(getUserOpHash(op2, entryPoint!.address, chainId));

  return {
    ...op2,
    signature: await signer.signMessage(message),
  };
}
