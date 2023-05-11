import { fillAndSign, fillUserOp, getDeployedAddress } from "./UserOp";
import {
  getAccountInitCode,
  goerliProvider,
  signer,
  createAccountOwner,
} from "./utils";
import {
  AccountFactory,
  AccountFactory__factory,
  EntryPoint,
  EntryPoint__factory,
} from "../typechain";
import { hexConcat, hexZeroPad } from "ethers/lib/utils";

const deployedAddresses = {
  accountFactoryAddr: "0x25D1CdbB5af19d0f2D622818597e6D83C767FB6E",
  paymasterAddr: "0xE6F5902cEC125B495d473eE7ab0320a658D48564",
  oracleAddr: "0xBe6Ad989eBe5Cdbf55986Ead24B4Aa5E63AB4522",
  tokenAddr: "0xE31B99163eE0344f168A1BaEad5804A2A03C6D38",
};

async function main() {
  signer.connect(goerliProvider);
  const accountFactory: AccountFactory = AccountFactory__factory.connect(
    deployedAddresses.accountFactoryAddr,
    goerliProvider
  );

  const entryPoint: EntryPoint = EntryPoint__factory.connect(
    "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    goerliProvider
  );
  const accountOwner = createAccountOwner();

  const userOp = await fillAndSign(
    accountFactory,
    {
      sender: await getDeployedAddress(
        accountFactory,
        accountOwner.address,
        "0x".padEnd(66, "0")
      ),
      initCode: getAccountInitCode(accountOwner.address, accountFactory, 0),
      paymasterAndData: hexConcat([
        deployedAddresses.paymasterAddr,
        hexZeroPad(deployedAddresses.tokenAddr, 20),
      ]),
    },
    accountOwner,
    entryPoint
  );
  console.log(JSON.stringify(userOp));
}

main();
