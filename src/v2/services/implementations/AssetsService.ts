import { ethers } from 'ethers';
import { inject, injectable } from 'inversify';
import { endpointKey } from 'src/config/chainEndpoints';
import { LOCAL_STORAGE } from 'src/config/localStorage';
import { handleCheckProviderChainId } from 'src/config/web3';
import { getEvmProvider } from 'src/hooks/helper/wallet';
import {
  AlertMsg,
  REQUIRED_MINIMUM_BALANCE,
  REQUIRED_MINIMUM_BALANCE_ETH,
} from 'src/modules/toast/index';
import { astarNativeTokenErcAddr } from 'src/modules/xcm';
import { container } from 'src/v2/common';
import { IEventAggregator } from 'src/v2/messaging';
import { IAssetsRepository } from 'src/v2/repositories/IAssetsRepository';
import { IAssetsService, IWalletService } from 'src/v2/services';
import {
  ParamAssetTransfer,
  ParamEvmTransfer,
  ParamEvmWithdraw,
} from 'src/v2/services/IAssetsService';
import { Symbols } from 'src/v2/symbols';
import { ComposerTranslation } from 'vue-i18n';
import Web3 from 'web3';

@injectable()
export class AssetsService implements IAssetsService {
  private readonly wallet: IWalletService;

  constructor(
    @inject(Symbols.AssetsRepository)
    private AssetsRepository: IAssetsRepository,
    @inject(Symbols.WalletFactory) walletFactory: () => IWalletService,
    @inject(Symbols.CurrentWallet) private currentWallet: string,
    @inject(Symbols.EventAggregator) readonly eventAggregator: IEventAggregator
  ) {
    this.wallet = walletFactory();
  }

  public async transferNativeAsset(param: ParamAssetTransfer): Promise<void> {
    console.log('transferNativeAsset');
    const useableBalance = await this.AssetsRepository.getNativeBalance(param.senderAddress);
    console.log('useableBalance', ethers.utils.formatEther(useableBalance));
    // const isBalanceEnough =
    //   Number(ethers.utils.formatEther(useableBalance)) -
    //     Number(ethers.utils.formatEther(param.amount)) >
    //   REQUIRED_MINIMUM_BALANCE;
    const isBalanceEnough = true;

    if (isBalanceEnough) {
      const transaction = await this.AssetsRepository.getNativeTransferCall(param);
      const hash = await this.wallet.signAndSend({
        extrinsic: transaction,
        senderAddress: param.senderAddress,
        successMessage: param.successMessage,
      });
      param.finalizedCallback(String(hash));
    } else {
      throw new Error(AlertMsg.MINIMUM_BALANCE);
    }
  }

  public async transferEvmAsset(param: ParamEvmTransfer): Promise<void> {
    console.log('transferEvmAsset');
    const provider = getEvmProvider(this.currentWallet as any);
    const web3 = new Web3(provider as any);
    const t = container.get<ComposerTranslation>(Symbols.I18Translation);

    const resultCheckProvider = await handleCheckProviderChainId(provider);
    if (!resultCheckProvider) {
      throw Error(t('warning.connectedInvalidNetwork'));
    }

    const balWei = await web3.eth.getBalance(param.senderAddress);
    const useableBalance = Number(ethers.utils.formatEther(balWei));
    console.log('useableBalance', useableBalance);
    const amount = param.contractAddress === astarNativeTokenErcAddr ? Number(param.amount) : 0;
    const networkIdxStore = String(localStorage.getItem(LOCAL_STORAGE.NETWORK_IDX));

    const minBal =
      Number(networkIdxStore) === endpointKey.ASTAR_ZKEVM
        ? REQUIRED_MINIMUM_BALANCE_ETH
        : REQUIRED_MINIMUM_BALANCE;

    // const isBalanceEnough = useableBalance - amount > minBal;
    const isBalanceEnough = true;
    if (isBalanceEnough) {
      const rawTx = await this.AssetsRepository.getEvmTransferData({
        param,
        web3,
      });

      const isErc20 = !!rawTx.data;

      const transactionHash = await this.wallet.sendEvmTransaction({
        from: param.senderAddress,
        to: isErc20 ? param.contractAddress : param.toAddress,
        value: isErc20 ? '0x0' : String(rawTx.value),
        data: isErc20 ? rawTx.data : null,
      });

      param.finalizedCallback(transactionHash);
    } else {
      throw Error(AlertMsg.MINIMUM_BALANCE);
    }
  }

  public async evmWithdraw({ amount, senderAddress }: ParamEvmWithdraw): Promise<void> {
    const transaction = await this.AssetsRepository.getEvmWithdrawCall({ amount, senderAddress });
    await this.wallet.signAndSend({
      extrinsic: transaction,
      senderAddress,
    });
  }

  public async unlockVestingTokens(senderAddress: string): Promise<void> {
    const transaction = await this.AssetsRepository.getVestCall();
    await this.wallet.signAndSend({
      extrinsic: transaction,
      senderAddress,
    });
  }
}
