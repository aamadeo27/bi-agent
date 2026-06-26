// Connectors (pg/mysql2/bigquery/undici) + query proxy are implemented in T4.2+.
// This module exports the credential vault for use by the proxy and admin API.
export {
  encryptCredential,
  decryptCredential,
  setCredential,
  getCredential,
  deleteCredential,
  getMasterKey,
  KEY_REF_V1,
} from "./vault.js";
