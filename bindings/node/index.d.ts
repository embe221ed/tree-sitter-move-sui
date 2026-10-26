type BaseNode = {
  type: string;
  named: boolean;
};

type ChildNode = {
  multiple: boolean;
  required: boolean;
  types: BaseNode[];
};

// Match the supported node-tree-sitter peer's public Language type so this
// object can be passed directly to Parser.setLanguage in TypeScript.
type NodeInfo =
  | (BaseNode & {
      subtypes: BaseNode[];
    })
  | (BaseNode & {
      fields: { [name: string]: ChildNode };
      children: ChildNode[];
    });

type Language = {
  name: string;
  language: unknown;
  nodeTypeInfo: NodeInfo[];
};

declare const language: Language;
export = language;
