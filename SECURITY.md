# Security model

Pi has no built-in permission boundary for filesystem, process, network, or credential access. In this
package, the Debian VM is the containment boundary and Pi inherits the permissions of the account that
launches it.

Recommended baseline:

- run Pi as a dedicated non-root user;
- expose only the project directories the agent needs;
- mount host-shared folders read-only unless writes are required;
- keep API keys in Pi's auth store or an injected environment variable, never in project files;
- snapshot the VM before long or unattended tasks;
- review project packages and trust prompts before approval; and
- keep backups outside paths that Pi can modify.

`respawn-pi` does not install Docker, add MCP servers, open network listeners, or weaken Debian permissions.
The isolation canary can test a boundary supplied by an operator, but a passing probe is not a complete
security assessment.
