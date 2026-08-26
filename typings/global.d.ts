declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare const __webAgentRuntimeVersion__: string;
declare const __webAgentRuntimeProtocolVersion__: number;
declare const __webAgentRuntimeAssetName__: string;
declare const __webAgentRuntimeDownloadUrl__: string;
declare const __webAgentRuntimeReleaseUrl__: string;
declare const __webAgentRuntimeSha256__: string;
declare const __webAgentRuntimeSize__: number;
