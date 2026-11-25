// Contrato de efeito do telefone da ficha PRINCIPAL do paciente conferido pela área de DDD (02-CAD linha 14), contra
// o MariaDB real (cliente de teste): o DDD sem área ativa no plano de numeração e o número sem a forma de fixo ou
// móvel da área são recusados com o campo, e nada fica gravado (nem pessoa, nem telefone); o válido grava; na
// alteração só o número que muda é conferido (o já gravado segue como está). Massa SINTÉTICA, limpa no fim.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO)('telefone da ficha principal pela área de DDD (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCadastroPropria;
  let m: Massa | null = null;
  const cpfRecusado = cpfSintetico('990114001');
  const cpfAceito = cpfSintetico('990114002');
  let id = 0;

  const contar = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f31-06-conta' }, async (l) =>
      Number((await l.uma<{ n: unknown }>(sql, p))?.n ?? 0),
    );
  const telefonesVivos = (paciente: number) =>
    contar(
      `SELECT COUNT(*) AS n FROM telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id
        WHERE p.id = ? AND t.excluido_em IS NULL`,
      [paciente],
    );

  const novo = (cpf: string, nome: string, telefones: Record<string, string>) => ({
    nome,
    nascimento: '1975-03-09',
    sexo: 'M' as const,
    cpf,
    nomeMae: `MAE ${MARCA}`,
    naturalidade: 'BELO HORIZONTE',
    ufNaturalidade: 'MG',
    cep: CEP_TESTE,
    numero: 14,
    ...telefones,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    // A regra lê o catálogo das áreas de DDD (carregador oficial): sem ele carregado, a prova não vale.
    expect(await contar('SELECT COUNT(*) AS n FROM area_ddd WHERE ativo', [])).toBeGreaterThanOrEqual(67);
    expect(await contar("SELECT COUNT(*) AS n FROM area_ddd WHERE codigo_anatel = '20'", [])).toBe(0);
    porta = new PortaCadastroPropria(nucleo, CLIENTE_F22);
  });

  afterAll(async () => {
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('cadastro recusa DDD fora do plano, celular sem forma de móvel e fixo sem forma, com o campo; nada gravado', async () => {
    const mm = m!;
    const tentar = (telefones: Record<string, string>) =>
      porta.cadastrar(
        contextoPorta(mm),
        novo(cpfRecusado, `TELEFONE RECUSADO ${MARCA}`, telefones),
        contextoGravacao(mm),
      );
    await expect(tentar({ celular: '20999990114' })).rejects.toMatchObject({
      problema: { codigo: 'telefone-invalido', campos: ['celular'] },
    });
    // Fixo válido no campo do celular: o celular exige número móvel.
    await expect(tentar({ celular: '3133330114' })).rejects.toMatchObject({
      problema: { codigo: 'telefone-invalido', campos: ['celular'] },
    });
    await expect(tentar({ telefone: '3183330114' })).rejects.toMatchObject({
      problema: { codigo: 'telefone-invalido', campos: ['telefone'] },
    });
    await expect(
      tentar({ celular: '31999990114', contatoNome: `CONTATO ${MARCA}`, contatoTelefone: '0033330114' }),
    ).rejects.toMatchObject({ problema: { codigo: 'telefone-invalido', campos: ['contatoTelefone'] } });
    expect(await contar('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [cpfRecusado])).toBe(0);
  });

  it('cadastro com fixo, celular e recado válidos grava as três linhas com DDD e número separados', async () => {
    const mm = m!;
    const r = await porta.cadastrar(
      contextoPorta(mm),
      novo(cpfAceito, `TELEFONE ACEITO ${MARCA}`, {
        telefone: '3133330114',
        celular: '31999990114',
        contatoNome: `CONTATO ${MARCA}`,
        contatoTelefone: '11999990114',
      }),
      contextoGravacao(mm),
    );
    id = r.resultado.idPaciente;
    expect(await telefonesVivos(id)).toBe(3);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id
           JOIN area_ddd a ON a.codigo_anatel = t.ddd AND a.ativo
          WHERE p.id = ? AND t.ddi = '55' AND CHAR_LENGTH(t.numero) IN (a.digitos_fixo, a.digitos_movel)`,
        [id],
      ),
    ).toBe(3);
  });

  it('alteração recusa o número novo inválido sem mexer no gravado, e grava o válido trocando a linha viva', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const [antes] = await porta.lerPacientes(c, [id]);
    await expect(
      porta.alterar(
        c,
        { idPaciente: id, versao: antes!.versao, alteracoes: { celular: '20999990114' } },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'telefone-invalido', campos: ['celular'] } });
    await expect(
      porta.alterar(
        c,
        { idPaciente: id, versao: antes!.versao, alteracoes: { telefone: '319999901' } as never },
        contextoGravacao(mm),
      ),
    ).rejects.toBeTruthy();
    const [igual] = await porta.lerPacientes(c, [id]);
    expect(igual).toMatchObject({ celular: '31999990114', telefone: '3133330114', versao: antes!.versao });
    expect(await telefonesVivos(id)).toBe(3);

    await porta.alterar(
      c,
      { idPaciente: id, versao: antes!.versao, alteracoes: { celular: '21988880114' } },
      contextoGravacao(mm),
    );
    const [depois] = await porta.lerPacientes(c, [id]);
    expect(depois).toMatchObject({ celular: '21988880114', telefone: '3133330114' });
    expect(depois!.versao).not.toBe(antes!.versao);
    // A linha antiga do celular fica no histórico (exclusão lógica), nunca apagada.
    expect(await telefonesVivos(id)).toBe(3);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id
          WHERE p.id = ? AND t.excluido_em IS NOT NULL AND t.ddd = '31' AND t.numero = '999990114'`,
        [id],
      ),
    ).toBe(1);
  });

  it('número já gravado fora da forma (vindo de outra base) não trava a alteração do nome do contato', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    // Simula o recado antigo fora da forma: a linha viva do recado passa a ter 8 dígitos começando por 8 (móvel antigo, sem o nono dígito).
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f31-06-preparo' }, async (e) => {
      await e.executar(
        `UPDATE telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id
            JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
            SET t.numero = '83330114' WHERE p.id = ? AND tt.codigo = 'recado' AND t.excluido_em IS NULL`,
        [id],
      );
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id
          WHERE p.id = ? AND t.numero = '83330114' AND t.excluido_em IS NULL`,
        [id],
      ),
    ).toBe(1);
    const [antes] = await porta.lerPacientes(c, [id]);
    await porta.alterar(
      c,
      {
        idPaciente: id,
        versao: antes!.versao,
        alteracoes: { contatoNome: `OUTRO CONTATO ${MARCA}`, complemento: 'CASA 2' },
      },
      contextoGravacao(mm),
    );
    const [depois] = await porta.lerPacientes(c, [id]);
    // O recado é regravado com o nome novo e o número que já estava (não conferido de novo).
    expect(depois).toMatchObject({
      contatoNome: `OUTRO CONTATO ${MARCA}`,
      contatoTelefone: '1183330114',
      complemento: 'CASA 2',
    });
    expect(await telefonesVivos(id)).toBe(3);
  });
});
