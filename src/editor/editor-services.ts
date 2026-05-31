export type EditorMountSettings = typeof wpBlocksEverywhere;

export type EditorServiceContext = {
	container?: HTMLElement;
	editorType?: string;
	mode?: string;
	settings: EditorMountSettings;
	textarea?: HTMLTextAreaElement;
};

export type EditorAutosaveService =
	| ( ( payload: Record< string, unknown >, context: EditorServiceContext ) => unknown )
	| {
			delay?: number;
			save?: ( payload: Record< string, unknown >, context: EditorServiceContext ) => unknown;
			cancel?: ( context: EditorServiceContext ) => void;
	  }
	| null;

export type EditorNoticeService =
	| ( ( type: string, message: string, context: EditorServiceContext, details?: unknown ) => void )
	| {
			error?: ( message: string, context: EditorServiceContext, details?: unknown ) => void;
			success?: ( message: string, context: EditorServiceContext, details?: unknown ) => void;
			warning?: ( message: string, context: EditorServiceContext, details?: unknown ) => void;
			info?: ( message: string, context: EditorServiceContext, details?: unknown ) => void;
	  }
	| null;

export type EditorPermissionsService = {
	can?: ( capability: string, context: EditorServiceContext ) => boolean | undefined;
	canUploadMedia?: boolean | ( ( context: EditorServiceContext ) => boolean | undefined );
} | null;

export type EditorAutocompleteCompleter = Record< string, unknown >;

export type EditorAutocompleteService =
	| ( (
			completers: EditorAutocompleteCompleter[],
			context: EditorServiceContext
	  ) => EditorAutocompleteCompleter[] | void )
	| {
			completers?:
				| EditorAutocompleteCompleter[]
				| ( ( context: EditorServiceContext ) => EditorAutocompleteCompleter[] | void );
			filterCompleters?: (
				completers: EditorAutocompleteCompleter[],
				context: EditorServiceContext
			) => EditorAutocompleteCompleter[] | void;
	  }
	| null;

export interface EditorServices {
	apiFetch?: ( options: Record< string, unknown > ) => Promise< unknown >;
	apiFetchMiddleware?: ( options: Record< string, unknown >, next: Function ) => unknown;
	apiFetchMiddlewares?: Array< ( options: Record< string, unknown >, next: Function ) => unknown >;
	autocomplete?: EditorAutocompleteService;
	autosave?: EditorAutosaveService;
	fetchLinkSuggestions?: ( search: string, searchOptions?: Record< string, unknown > ) => Promise< unknown >;
	mediaUpload?: Function | null;
	notices?: EditorNoticeService;
	permissions?: EditorPermissionsService;
}

export interface EditorHostRuntimeAdapter {
	cleanup?: () => void;
	installHandlers?: () => void;
	onBeforeLoad?: () => Promise< void > | void;
	onContent?: ( blocks: object[], serialized: string, source: 'input' | 'change' | string ) => void;
	resolveAutocomplete?: ( context: EditorServiceContext ) => EditorAutocompleteService | undefined;
	resolveMediaUpload?: ( context: EditorServiceContext & { canUploadMedia: boolean } ) => Function | null | undefined;
}
