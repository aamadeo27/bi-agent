# Secret / cred vault — App-level envelope encryption via cloud KMS** (e.g. AES-256-GCM data keys)

**Chosen:** App-level envelope encryption via cloud KMS** (e.g. AES-256-GCM data keys)  
**Alternatives:** HashiCorp Vault, plain env

Encrypts per-(tenant,role,source) data-source credentials; KMS-managed master key.
