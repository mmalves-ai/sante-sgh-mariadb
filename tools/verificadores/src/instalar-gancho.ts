// Instala o gancho pre-commit versionado em .githooks/ (só configuração local do repositório).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  console.log('[gancho] sem .git: gancho pre-commit não instalado');
} else {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
  console.log('[gancho] pre-commit ativo (core.hooksPath=.githooks)');
}
