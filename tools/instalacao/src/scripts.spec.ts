import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arquivosGerados } from './artefatos.ts';
import { CONTEUDO_PACOTE } from './pacote.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const pasta = resolve(raiz, 'deploy/ubuntu');
const scripts = readdirSync(pasta).filter((n) => n.endsWith('.sh'));

describe('M60.2: os scripts de deploy/ubuntu', () => {
  it('existem os quatro da ficha mais a biblioteca e o empacotamento', () => {
    for (const n of [
      'instalar.sh',
      'atualizar.sh',
      'voltar-versao.sh',
      'desinstalar.sh',
      'lib.sh',
      'empacotar.sh',
      'migrar.sh',
      'verificar.sh',
      'liberar.sh',
    ])
      expect(scripts).toContain(n);
  });

  it('todos passam no bash -n e começam com set -euo pipefail', () => {
    for (const n of scripts) {
      execFileSync('bash', ['-n', resolve(pasta, n)]);
      expect(readFileSync(resolve(pasta, n), 'utf8'), n).toContain('set -euo pipefail');
    }
  });

  it('todo arquivo gerado citado pelos scripts existe no gerador e no repositório', () => {
    const gerados = new Set(Object.keys(arquivosGerados()));
    for (const n of scripts) {
      const t = readFileSync(resolve(pasta, n), 'utf8');
      for (const m of t.matchAll(/gerado\/([a-z]+\/[A-Za-z0-9_.$-]+)/g)) {
        const rel = m[1]!.replace('$SANTE_UNIT', 'sante-sgh');
        expect(gerados.has(rel), `${n}: ${rel}`).toBe(true);
        expect(existsSync(resolve(pasta, 'gerado', rel)), rel).toBe(true);
      }
    }
  });

  it('as ferramentas que os scripts chamam no servidor vão no pacote', () => {
    const t = scripts.map((n) => readFileSync(resolve(pasta, n), 'utf8')).join('\n');
    for (const m of t.matchAll(/(tools\/[a-z-]+)\/src\/[a-z-]+\.ts/g))
      expect(
        CONTEUDO_PACOTE.some((c) => m[1]!.startsWith(c) || c.startsWith(m[1]!)),
        m[1],
      ).toBe(true);
    expect(CONTEUDO_PACOTE).toContain('deploy/ubuntu');
  });

  it('nenhum script guarda segredo nem fala com o banco', () => {
    for (const n of scripts) {
      const t = readFileSync(resolve(pasta, n), 'utf8');
      expect(t, n).not.toMatch(/isql|SYSDBA|masterkey|FB_[A-Z]+_SENHA=/);
    }
  });
});

describe('M60.2: o ensaio da instalação (deploy/ubuntu/ensaio, só na máquina da obra)', () => {
  const ensaio = resolve(pasta, 'ensaio/ensaiar.sh');
  const texto = readFileSync(ensaio, 'utf8');

  it('passa no bash -n, começa com set -euo pipefail e não vai no artefato', () => {
    execFileSync('bash', ['-n', ensaio]);
    expect(texto).toContain('set -euo pipefail');
    const construir = readFileSync(resolve(pasta, 'construir-no-conteiner.sh'), 'utf8');
    expect(construir).toContain('rm -rf "$P/deploy/ubuntu/ensaio"');
  });

  it('nunca aponta para as cópias compartilhadas nem põe senha na linha de comando do docker', () => {
    expect(texto).not.toMatch(/\b335[12]\b|copia\.lock\b.*travas|obra-sgh\/travas/);
    // O apelido do contêiner da cópia só existe na rede própria do ensaio (nunca --network redesante-banco).
    expect(texto).not.toMatch(/redesante-banco/);
    // Toda senha vai ao docker por -e NOME sem valor (o valor só no ambiente do processo).
    expect(texto).not.toMatch(/-e [A-Z_]*(SENHA|PASSWORD|CHAVE)[A-Z_]*=/);
    expect(texto).toMatch(/docker (rm|volume rm|network rm|image rm)/);
  });
});
