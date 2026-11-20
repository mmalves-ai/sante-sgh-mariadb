// Verificador do data mart (M16, regra 17): verde sem carga e com uma carga limpa; vermelho com um arquivo que tenha
// coluna identificadora (fixture sintética numa pasta temporária).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, 'datamart.ts');
const pasta = mkdtempSync(join(tmpdir(), 'sgh-datamart-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const rodar = () =>
  spawnSync(process.execPath, ['--import', resolve(import.meta.dirname, 'caminhos-sgh.ts'), script], {
    env: { ...process.env, DATA_MART_DIR: pasta },
    encoding: 'utf8',
  });

describe('verificador do data mart', () => {
  it('verde com o esquema declarado e um arquivo limpo', () => {
    const db = new DatabaseSync(join(pasta, 'xx.sqlite'));
    db.exec('CREATE TABLE fato_x (mes TEXT, paciente_pseudonimo TEXT, quantidade INTEGER)');
    db.close();
    const r = rodar();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/1 arquivo\(s\) carregado\(s\); coluna identificadora 0 → verde/);
  });

  it('vermelho com coluna identificadora no arquivo', () => {
    const db = new DatabaseSync(join(pasta, 'yy.sqlite'));
    db.exec('CREATE TABLE fato_y (mes TEXT, nome TEXT, cpf TEXT)');
    db.close();
    const r = rodar();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/yy\.sqlite:fato_y\.nome/);
    expect(r.stdout).toMatch(/yy\.sqlite:fato_y\.cpf/);
  });
});
