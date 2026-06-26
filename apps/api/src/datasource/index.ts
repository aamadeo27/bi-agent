// Credential vault (T4.1)
export {
  encryptCredential,
  decryptCredential,
  setCredential,
  getCredential,
  deleteCredential,
  getMasterKey,
  KEY_REF_V1,
} from "./vault.js";

// Connector interface + shared types (T4.2/T4.3)
export type {
  Connector,
  QueryResult,
  QueryColumn,
  RestQuery,
  SchemaTree,
  ColumnType,
} from "./connector.js";

// REST connector (T4.3)
export {
  RestConnector,
  ConnectorValidationError,
  ConnectorDataSourceError,
  REST_SCHEMA_NAME,
} from "./rest-connector.js";
export type {
  EndpointDecl,
  RestCredential,
  RestConnectorOptions,
} from "./rest-connector.js";
