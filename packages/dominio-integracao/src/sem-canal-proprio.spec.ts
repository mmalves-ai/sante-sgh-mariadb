// Regra 15a (DP-44 b): nenhuma dependência de provedor de mensagem nem endereço de API de provedor no monorepo; toda
// comunicação com o paciente pela Hal-AI. O teste varre todos os package.json do monorepo e o código de apps/ e
// packages/ (fora node_modules e dist).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dependenciasDeCanalProprio,
  enderecosDeCanalProprio,
  type PacoteDeclarado,
  podeEnviarAoPaciente,
} from './sem-canal-proprio.js';

const raiz = resolve(import.meta.dirname, '../../..');
const IGNORAR = new Set(['node_modules', 'dist', 'coverage', '.nx', '.tmp', 'test-results', '.seguranca']);

function arquivos(dir: string, filtro: (n: string) => boolean): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    if (IGNORAR.has(n) || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) r.push(...arquivos(p, filtro));
    else if (filtro(n)) r.push(p);
  }
  return r;
}

describe('sem canal próprio de mensagem (regra 15a)', () => {
  it('nenhum package.json do monorepo depende de provedor de WhatsApp, SMS ou chat', () => {
    const pacotes: PacoteDeclarado[] = [
      resolve(raiz, 'package.json'),
      ...arquivos(resolve(raiz, 'apps'), (n) => n === 'package.json'),
      ...arquivos(resolve(raiz, 'packages'), (n) => n === 'package.json'),
    ].map((arquivo) => {
      const j = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      return {
        arquivo: relative(raiz, arquivo),
        dependencias: { ...j['dependencies'], ...j['devDependencies'], ...j['optionalDependencies'] },
      };
    });
    expect(pacotes.length).toBeGreaterThan(0);
    expect(dependenciasDeCanalProprio(pacotes)).toEqual([]);
    // A conferência acusa quando aparece.
    expect(
      dependenciasDeCanalProprio([{ arquivo: 'x/package.json', dependencias: { twilio: '1' } }]),
    ).toEqual(['x/package.json: twilio']);
  });

  it('o código não fala com endereço de provedor de mensagem', () => {
    const fontes = [
      ...arquivos(resolve(raiz, 'apps'), (n) => /\.(ts|vue)$/.test(n)),
      ...arquivos(resolve(raiz, 'packages'), (n) => /\.(ts|vue)$/.test(n)),
    ].filter((f) => !f.endsWith('sem-canal-proprio.ts') && !f.endsWith('sem-canal-proprio.spec.ts'));
    expect(fontes.length).toBeGreaterThan(100);
    const achados = fontes.flatMap((f) =>
      enderecosDeCanalProprio(relative(raiz, f), readFileSync(f, 'utf8')),
    );
    expect(achados).toEqual([]);
    expect(enderecosDeCanalProprio('x.ts', "fetch('https://api.twilio.com/2010-04-01')")).toHaveLength(1);
  });

  it('a mensagem ao paciente só sai pela Hal-AI ligada e, fora de produção, só para endereço local', () => {
    expect(
      podeEnviarAoPaciente({ ligado: false, endereco: 'http://127.0.0.1:1', producao: false }).pode,
    ).toBe(false);
    expect(podeEnviarAoPaciente({ ligado: true, endereco: null, producao: false }).motivo).toMatch(
      /não configurado/,
    );
    expect(podeEnviarAoPaciente({ ligado: true, endereco: '::', producao: false }).motivo).toMatch(
      /inválido/,
    );
    expect(
      podeEnviarAoPaciente({ ligado: true, endereco: 'https://api.halai.com.br', producao: false }).motivo,
    ).toMatch(/só endereço local/);
    expect(
      podeEnviarAoPaciente({ ligado: true, endereco: 'http://127.0.0.1:8090', producao: false }),
    ).toEqual({
      pode: true,
      motivo: null,
    });
    expect(
      podeEnviarAoPaciente({ ligado: true, endereco: 'https://api.halai.com.br', producao: true }).pode,
    ).toBe(true);
  });
});
