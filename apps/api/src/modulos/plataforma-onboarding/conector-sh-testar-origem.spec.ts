// conector/conector.sh testar-origem: montagem do container do "Testar conexão" com um `docker` falso no PATH.
// Confere que o teste de conexão nunca recebe a senha root do MariaDB (só a conta restrita do motor), roda sem
// privilégio e, em produção, é ligado também à rede que alcança o servidor do hospital (CONECTOR_REDE_ORIGEM) antes de
// iniciar; a rede interna é --internal, sem saída. Nenhum container de verdade é criado.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// Senha falsa do root do MariaDB para o teste (constante: o verificador de segredos recusa literal na chave).
const SENHA_RAIZ_FALSA = 'raiz-falsa';
const SCRIPT = fileURLToPath(new URL('../../../../../conector/conector.sh', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'conector-sh-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const DOCKER_FALSO = `#!/usr/bin/env bash
echo "CHAMADA $*" >> "$LOG_DOCKER"
case "$1 $2" in
  "network inspect") [ "\${3:-}" ] && [ "\${4:-}" = -f ] && echo 172.30.0.0/16; exit 0 ;;
  "network connect") exit 0 ;;
  "image inspect") exit 0 ;;
esac
case "$1" in
  build|rm) exit 0 ;;
  inspect) echo '{"sante-sgh-conector-int":{}}'; exit 0 ;;
  run) echo '{"conta": "sscon_motor_teste"}'; exit 0 ;;
  create)
    echo "AMBIENTE_CREATE usuario=$CONECTOR_MARIADB_USUARIO raiz=$([ "$CONECTOR_MARIADB_SENHA" = raiz-falsa ] && echo sim || echo nao)" >> "$LOG_DOCKER"
    echo ct-teste; exit 0 ;;
  start) echo '{"ok": true}'; exit "\${RC_FALSO:-0}" ;;
esac
exit 0
`;

function rodar(extra: Record<string, string>): { status: number | null; log: string[] } {
  const dir = mkdtempSync(join(tmp, 'caso-'));
  writeFileSync(join(dir, 'docker'), DOCKER_FALSO);
  chmodSync(join(dir, 'docker'), 0o755);
  const log = join(dir, 'docker.log');
  writeFileSync(log, '');
  const r = spawnSync('bash', [SCRIPT, 'testar-origem', 'exemplo'], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      LOG_DOCKER: log,
      CONECTOR_DADOS_DIR: dir, // sem pasta de segredos: senha do motor aleatória, nada lido do disco real
      CONECTOR_MARIADB_SENHA: SENHA_RAIZ_FALSA,
      PLATAFORMA_CHAVE_MESTRA: 'chave-falsa',
      COFRE_DIR: join(dir, 'sem-cofre'),
      AMBIENTE: 'dev',
      ...extra,
    },
  });
  return { status: r.status, log: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

describe('conector.sh testar-origem', () => {
  it('conta restrita do motor, sem senha root, sem privilégio, só a rede interna sem CONECTOR_REDE_ORIGEM', () => {
    const { status, log } = rodar({});
    expect(status).toBe(0);
    const create = log.find((l) => l.startsWith('CHAMADA create '));
    expect(create).toBeDefined();
    expect(create).toContain('--network sante-sgh-conector-int');
    expect(create).toContain('--cap-drop ALL');
    expect(create).toContain('--security-opt no-new-privileges');
    expect(create).not.toContain('--privileged');
    expect(create).not.toContain('--user 0:0');
    expect(create).not.toContain(SENHA_RAIZ_FALSA);
    expect(log).toContain('AMBIENTE_CREATE usuario=sscon_motor_teste raiz=nao');
    expect(log.some((l) => l.startsWith('CHAMADA network connect'))).toBe(false);
    expect(log.some((l) => l.startsWith('CHAMADA start -a ct-teste'))).toBe(true);
  });

  it('com CONECTOR_REDE_ORIGEM: liga o container à rede do hospital antes de iniciar; repassa o código de saída', () => {
    const { status, log } = rodar({ CONECTOR_REDE_ORIGEM: 'rede-hospital', RC_FALSO: '3' });
    expect(status).toBe(3);
    const ligar = log.indexOf('CHAMADA network connect rede-hospital ct-teste');
    const iniciar = log.findIndex((l) => l.startsWith('CHAMADA start -a ct-teste'));
    expect(ligar).toBeGreaterThanOrEqual(0);
    expect(iniciar).toBeGreaterThan(ligar);
    expect(log).toContain('AMBIENTE_CREATE usuario=sscon_motor_teste raiz=nao');
  });

  it('CONECTOR_REDE_ORIGEM igual à rede interna não liga de novo', () => {
    const { status, log } = rodar({ CONECTOR_REDE_ORIGEM: 'sante-sgh-conector-int' });
    expect(status).toBe(0);
    expect(log.some((l) => l.startsWith('CHAMADA network connect'))).toBe(false);
  });
});
