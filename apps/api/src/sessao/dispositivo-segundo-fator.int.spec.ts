// Contrato de efeito da chave do dispositivo (WebAuthn; 01-ADM L62) contra o MariaDB real (cliente de teste f22_o5,
// 02_ADM/99w aplicada aqui): cadastro grava SÓ a chave pública e o contador (nenhum dado biométrico), validação anda
// o contador e grava o uso, contador que regride e desafio reusado são recusados sem gravar, revogação tira a
// credencial da validação. Dispositivo SIMULADO (par de chaves gerado no teste) e conta FICTÍCIA fixa.
// Rodar: vitest run -c apps/api/vitest.integracao.config.ts src/sessao/dispositivo-segundo-fator.int.spec.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AutenticadorWebAuthnSimulado } from '@sgh/dominio-acesso';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria } from './armazem.js';
import { CredencialDispositivoPropria, ServicoDispositivoSegundoFator } from './dispositivo-segundo-fator.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const CLIENTE = process.env['SGH_CLIENTE_TESTE_ACESSO_EMAIL']?.trim() || 'f22_o5';
const BANCO = `cliente_${CLIENTE}`;
const HOSPITAL = 'wan01';
const LOGIN = 'wan.joana';
const URL_PUBLICA = 'https://hospital.exemplo:5310/';
const SERVIDOR = 'hospital.exemplo';
const ORIGEM = 'https://hospital.exemplo:5310';

function sql(texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), BANCO, '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe.skipIf(SEM_BANCO)('chave do dispositivo (WebAuthn) no banco próprio', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoDispositivoSegundoFator;
  let idEst = 0;
  const ator = {
    rede: 'rede-teste',
    hospital: HOSPITAL,
    login: LOGIN,
    estacao: 'teste-wan',
    correlacao: 'wan-int',
  };
  const contar = (onde = '') =>
    Number(
      sql(`SELECT COUNT(*) FROM credencial_dispositivo d JOIN usuario u ON u.id = d.usuario_id
            WHERE u.login = '${LOGIN}' ${onde}`).trim(),
    );

  beforeAll(async () => {
    for (const arq of ['99w_credencial_dispositivo_tabelas.sql', '99w_credencial_dispositivo_chaves.sql'])
      sql(readFileSync(resolve(RAIZ, 'db/migracoes/02_ADM', arq), 'utf8'));
    sql(`INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em)
           SELECT '${HOSPITAL}', 'Hospital fictício wan', 'Hospital fictício wan (teste)', NOW(3)
            WHERE NOT EXISTS (SELECT 1 FROM estabelecimento WHERE codigo = '${HOSPITAL}');
         INSERT INTO usuario (login, nome, dispensa_cpf, criado_em)
           SELECT '${LOGIN}', 'Conta fictícia wan', TRUE, NOW(3)
            WHERE NOT EXISTS (SELECT 1 FROM usuario WHERE login = '${LOGIN}');
         UPDATE credencial_dispositivo d JOIN usuario u ON u.id = d.usuario_id
            SET d.revogada_em = NOW(3) WHERE u.login = '${LOGIN}' AND d.revogada_em IS NULL;`);
    idEst = Number(sql(`SELECT id FROM estabelecimento WHERE codigo = '${HOSPITAL}'`).trim());
    nucleo = new NucleoProprio();
    const porta = new CredencialDispositivoPropria(nucleo, () => ({
      cliente: CLIENTE,
      estabelecimento: idEst,
    }));
    servico = new ServicoDispositivoSegundoFator(porta, new ArmazemMemoria(), URL_PUBLICA);
  }, 60_000);

  afterAll(async () => {
    await nucleo?.encerrar?.();
  });

  it('cadastra, valida, recusa reuso e regressão, revoga', async () => {
    const antes = contar();
    const disp = new AutenticadorWebAuthnSimulado(-7, 5);
    const op = await servico.iniciarCadastro('sessao-1', ator, 'Conta fictícia wan');
    expect(op.rp.id).toBe(SERVIDOR);
    const { id } = await servico.concluirCadastro(
      'sessao-1',
      ator,
      disp.cadastrar(op.challenge, ORIGEM, SERVIDOR),
      '  Celular  fictício ',
    );
    expect(contar()).toBe(antes + 1);
    const linha = sql(
      `SELECT nome, algoritmo, contador_assinatura, formato_atestado, verificacao_usuario, ultimo_uso_em IS NULL,
              CHAR_LENGTH(chave_publica) > 40, revogada_em IS NULL FROM credencial_dispositivo WHERE id = ${id}`,
    )
      .trim()
      .split('\t');
    expect(linha).toEqual(['Celular fictício', '-7', '5', 'none', '1', '1', '1', '1']);
    const trilhaCad = Number(
      sql(
        `SELECT COUNT(*) FROM trilha_auditoria WHERE entidade = 'credencial_dispositivo' AND entidade_id = ${id}`,
      ).trim(),
    );
    expect(trilhaCad).toBe(1);

    // Mesmo desafio duas vezes: o segundo pedido não acha o desafio (uso único) e nada se grava.
    await expect(
      servico.concluirCadastro('sessao-1', ator, disp.cadastrar(op.challenge, ORIGEM, SERVIDOR), 'x'),
    ).rejects.toMatchObject({ problema: { codigo: 'desafio-incorreto' } });
    expect(contar()).toBe(antes + 1);

    const v = await servico.iniciarValidacao('sessao-1', ator);
    expect(v.allowCredentials.map((c) => c.id)).toContain(disp.idCredencial);
    await expect(
      servico.concluirValidacao('sessao-1', ator, disp.validar(v.challenge, ORIGEM, SERVIDOR)),
    ).resolves.toEqual({ id });
    expect(
      sql(
        `SELECT contador_assinatura, ultimo_uso_em IS NOT NULL FROM credencial_dispositivo WHERE id = ${id}`,
      ).trim(),
    ).toBe('6\t1');

    // Contador que não anda (cópia da chave): recusa e o contador gravado fica.
    const v2 = await servico.iniciarValidacao('sessao-1', ator);
    await expect(
      servico.concluirValidacao('sessao-1', ator, disp.validar(v2.challenge, ORIGEM, SERVIDOR, false)),
    ).rejects.toMatchObject({ problema: { codigo: 'contador-regrediu' } });
    expect(sql(`SELECT contador_assinatura FROM credencial_dispositivo WHERE id = ${id}`).trim()).toBe('6');

    expect((await servico.listar(ator)).map((d) => d.id)).toContain(id);
    await servico.revogar(ator, id);
    expect(contar(`AND d.id = ${id} AND d.revogada_em IS NOT NULL AND d.revogada_por = u.id`)).toBe(1);
    expect((await servico.listar(ator)).map((d) => d.id)).not.toContain(id);
    await expect(servico.iniciarValidacao('sessao-1', ator)).rejects.toMatchObject({
      problema: { codigo: 'sem-dispositivo' },
    });
    await expect(servico.revogar(ator, id)).rejects.toMatchObject({
      problema: { codigo: 'dispositivo-inexistente' },
    });
  }, 60_000);
});
