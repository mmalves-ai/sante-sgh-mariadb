// Contrato de efeito da regra de campo do cadastro na abertura do atendimento (F3.1, 02-CAD linha 2) contra o MariaDB
// real (cliente de teste; f22_o1 por padrão). Prova o que fica no banco: com o cadastro do paciente incompleto no
// escopo da recepção (tipo de atendimento, convênio, módulo de recepção), a abertura é recusada com os campos que
// faltam e NENHUM atendimento é gravado; fora do escopo da regra, com o cadastro completado ou com o cadastro
// provisório (não identificado), o atendimento abre. Massa SINTÉTICA; as regras são só do estabelecimento da massa e
// saem no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
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
} from '../cadastro/massa.spec-util.js';
import { FichaComplementarPropria } from '../cadastro/ficha-complementar-proprio.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';

const ROTULO = `REGRA ABERTURA ${MARCA}`;
const MODULO = `ABERT-${MARCA}`.slice(0, 30);

describe.skipIf(SEM_BANCO)('regra de campo do cadastro na abertura do atendimento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let ficha: FichaComplementarPropria;
  let m: Massa;
  let paciente = 0;
  let provisorio = 0;
  let modulo = 0;

  const escrever = <T>(fn: Parameters<NucleoProprio['escrever']>[1]) =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f31-01-preparo' }, fn) as Promise<T>;
  const contar = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f31-01-conta' }, async (l) =>
      Number((await l.uma<{ n: unknown }>(sql, p))?.n ?? 0),
    );
  const atendimentosDe = (p: number) =>
    contar('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [p]);
  const limparRegras = () =>
    escrever(async (e) => {
      await e.executar('DELETE FROM regra_campo_cadastro WHERE estabelecimento_id IN (?, ?) AND rotulo = ?', [
        m.estabelecimento,
        m.outroEstabelecimento,
        ROTULO,
      ]);
    });
  const regra = (
    campo: string,
    r: {
      tipo?: string;
      fonte?: number | null;
      modulo?: number | null;
      est?: number;
      exigencia?: string;
    } = {},
  ) =>
    escrever(async (e) => {
      await e.executar(
        `INSERT INTO regra_campo_cadastro (estabelecimento_id, entidade, campo, modulo_recepcao_id, tipo_atendimento,
                                           fonte_pagadora_id, exigencia, rotulo, ativo, criado_em)
         VALUES (?, 'paciente', ?, ?, ?, ?, ?, ?, TRUE, ?)`,
        [
          r.est ?? m.estabelecimento,
          campo,
          r.modulo ?? null,
          r.tipo ?? 'todos',
          r.fonte ?? null,
          r.exigencia ?? 'obrigatorio',
          ROTULO,
          new Date(),
        ],
      );
    });
  const cadastrar = async (nome: string, base9: string) =>
    (
      await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
        contextoPorta(m),
        {
          nome: `${nome} ${MARCA}`,
          nascimento: '1981-04-05',
          sexo: 'F',
          cpf: cpfSintetico(base9),
          naturalidade: 'BELO HORIZONTE',
          ufNaturalidade: 'MG',
          cep: CEP_TESTE,
        },
        contextoGravacao(m),
      )
    ).resultado.idPaciente;
  const abrir = (p: number, extra: Record<string, unknown> = {}) =>
    porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente: p,
        convenio: m.fonte,
        matricula: '123456',
        profissional: m.profissional,
        especialidade: m.especialidade,
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        procedimento: m.procedimento,
        cidPrincipal: m.cid,
        carater: 'eletivo',
        local: m.local,
        ...extra,
      },
      contextoGravacao(m),
    );
  const incompleto = (campos: string[]) => ({
    problema: expect.objectContaining({ codigo: 'cadastro-incompleto', campos }),
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    await limparRegras();
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    ficha = new FichaComplementarPropria(nucleo as never, CLIENTE_F22);
    paciente = await cadastrar('PACIENTE DA REGRA', '990131101');
    provisorio = await cadastrar('PACIENTE PROVISORIO', '990131102');
    await escrever(async (e) => {
      // O cadastro sintético fica sem nome da mãe e sem e-mail; o segundo vira provisório (não identificado).
      await e.executar(
        'UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id SET pf.nome_mae = NULL WHERE p.id IN (?, ?)',
        [paciente, provisorio],
      );
      await e.executar("UPDATE paciente SET situacao = 'provisorio' WHERE id = ?", [provisorio]);
      const x = await e.uma<{ id: unknown }>('SELECT id FROM modulo_recepcao WHERE codigo = ?', [MODULO]);
      modulo = x
        ? Number(x.id)
        : await e.inserir('INSERT INTO modulo_recepcao (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
            MODULO,
            `MODULO SINTETICO ${MARCA}`,
            new Date(),
          ]);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) {
      await limparRegras().catch(() => undefined);
      await limparMassa(nucleo, m).catch(() => undefined);
    }
    if (modulo)
      await escrever(async (e) => {
        await e.executar('DELETE FROM modulo_recepcao WHERE id = ?', [modulo]);
      }).catch(() => undefined);
    await nucleo.encerrar();
  });

  it('regra do tipo de atendimento: a urgência é recusada com o campo que falta e nada é gravado; a consulta abre', async () => {
    await regra('nomeMae', { tipo: 'urgencia' });
    // A regra de outro estabelecimento não vale aqui.
    await regra('email', { est: m.outroEstabelecimento });
    const antes = await atendimentosDe(paciente);
    await expect(abrir(paciente, { tipo: 'pa', carater: 'urgencia' })).rejects.toMatchObject(
      incompleto(['nomeMae']),
    );
    expect(await atendimentosDe(paciente)).toBe(antes);
    // A conferência da tela (campos pendentes) diz o mesmo que a abertura.
    expect(
      await ficha.camposPendentes(contextoPorta(m), paciente, {
        modulo: null,
        tipoAtendimento: 'urgencia',
        fontePagadora: m.fonte,
      }),
    ).toEqual([{ campo: 'nomeMae', rotulo: ROTULO }]);
    const a = await abrir(paciente);
    expect(Number(a.resultado['reg'])).toBeGreaterThan(0);
    expect(await atendimentosDe(paciente)).toBe(antes + 1);
  });

  it('cadastro completado: a urgência abre; o cadastro provisório (não identificado) nunca é barrado', async () => {
    const antes = await atendimentosDe(provisorio);
    const p = await abrir(provisorio, { tipo: 'pa', carater: 'urgencia' });
    expect(Number(p.resultado['reg'])).toBeGreaterThan(0);
    expect(await atendimentosDe(provisorio)).toBe(antes + 1);

    await escrever(async (e) => {
      await e.executar(
        'UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id SET pf.mae_desconhecida = FALSE, pf.nome_mae = ? WHERE p.id = ?',
        [`MAE SINTETICA ${MARCA}`, paciente],
      );
    });
    const n = await atendimentosDe(paciente);
    const a = await abrir(paciente, { tipo: 'pa', carater: 'urgencia' });
    expect(Number(a.resultado['reg'])).toBeGreaterThan(0);
    expect(await atendimentosDe(paciente)).toBe(n + 1);
  });

  it('regra do convênio e do módulo de recepção: só recusa no escopo dela; o opcional mais específico libera', async () => {
    await limparRegras();
    await regra('email', { modulo });
    const n = await atendimentosDe(paciente);
    // Sem o módulo na abertura, a regra do módulo não vale.
    await abrir(paciente);
    expect(await atendimentosDe(paciente)).toBe(n + 1);
    await expect(abrir(paciente, { moduloRecepcao: modulo })).rejects.toMatchObject(incompleto(['email']));
    expect(await atendimentosDe(paciente)).toBe(n + 1);

    // Regra do convênio (mais específica que a do módulo): opcional para este convênio libera a abertura.
    await regra('email', { modulo, fonte: m.fonte, exigencia: 'opcional' });
    await abrir(paciente, { moduloRecepcao: modulo });
    expect(await atendimentosDe(paciente)).toBe(n + 2);

    // Obrigatório só para o convênio: recusa em qualquer módulo, com os dois campos em ordem.
    await limparRegras();
    await regra('email', { fonte: m.fonte });
    await regra('celular', { fonte: m.fonte });
    await expect(abrir(paciente)).rejects.toMatchObject(incompleto(['celular', 'email']));
    expect(await atendimentosDe(paciente)).toBe(n + 2);
    await limparRegras();
    await abrir(paciente);
    expect(await atendimentosDe(paciente)).toBe(n + 3);
  });
});
