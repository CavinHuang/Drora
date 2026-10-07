import type { ProviderProvisioningEnvelope, ProviderProvisioningResult } from "@drora/shared";
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 仅供 Window Host 调用的远端 Environment target，不加入 IServiceAccessor。 */
export interface IProviderProvisioningTargetService {
  apply(envelope: ProviderProvisioningEnvelope): Promise<ProviderProvisioningResult>;
}

export const IProviderProvisioningTargetService =
  createServiceDescriptor<IProviderProvisioningTargetService>(
    ServiceChannels.ProviderProvisioningTarget,
  );
