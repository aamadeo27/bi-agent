// Query Proxy (T4.4) — sole component that executes data-source queries
export {
  execute,
  ProxyCredentialNotFoundError,
  ProxyDataSourceNotFoundError,
  _clearConnectorCache,
  _drainConnectorCache,
} from "./query-proxy.js";
export type { ValidatedQuery, ProxyArgs } from "./query-proxy.js";

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

// SQL adapters (T4.2)
export type { SqlQuery } from "./sql-shared.js";

export { PgConnector } from "./pg-connector.js";
export type { PgCredential, PgConnectorOptions } from "./pg-connector.js";

export { MysqlConnector } from "./mysql-connector.js";
export type {
  MysqlCredential,
  MysqlConnectorOptions,
} from "./mysql-connector.js";

export { BigQueryConnector } from "./bigquery-connector.js";
export type {
  BigQueryCredential,
  BigQueryConnectorOptions,
} from "./bigquery-connector.js";
