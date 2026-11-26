// Lote migrado sem validade no uso em paciente (recusas da carga, fase 2, decisão D1) na porta própria contra o MariaDB
// real (cliente de teste do lote, SGH_CLIENTE_TESTE; massa SINTÉTICA "F22L0314", nenhuma pessoa real): a unitarização
// de dose e a abertura da ordem de manipulação recusam o lote com origem 'migracao' e validade nula com o código
// `lote-sem-validade` (nunca "vencido" nem "sem saldo") e não gravam nada; o saldo do lote fica intacto.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { NovaOrdemManipulacao } from './manipulacao-porta.js';
import { PortaManipulacaoPropria } from './manipulacao-porta-propria.js';
import {
  CLIENTE,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import { PortaUnitarizacaoDosePropria } from './unitarizacao-dose.js';

const RODADA = Date.now().toString(36);
let k = 0;
const chave = () => `rlsvp-${RODADA}-${++k}`;
const NOME = 'SINTETICO RLSVP';

interface Recusa {
  codigo: string;
  detalhe: string;
  campos: string[];
}

/** O código, o texto e os campos da recusa (ou "ok"). */
const recusaDe = (p: Promise<unknown>): Promise<Recusa> =>
  p.then(
    () => ({ codigo: 'ok', detalhe: '', campos: [] }),
    (e: { message?: string; problema?: Record<string, unknown> }) => ({
      codigo: String(e.problema?.['codigo'] ?? e),
      detalhe: String(e.problema?.['detail'] ?? e.message ?? ''),
      campos: (e.problema?.['campos'] as string[] | undefined) ?? [],
    }),
  );

describe.skipIf(SEM_BANCO)(
  'lote sem validade no uso em paciente: unitarização e manipulação (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let m: MassaSuprimentos;
    let unit: PortaUnitarizacaoDosePropria;
    let manip: PortaManipulacaoPropria;
    const ids: Record<string, number> = {};
    const ctxE = { cliente: CLIENTE, correlacao: 't-rlsvp' };
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente(ctxE, (l) => l.consultar<T>(sql, p));
    const saldoDoLote = async () =>
      Number(
        (
          await ler<{ q: unknown }>(
            'SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ?',
            [ids.loteSem, m.localA],
          )
        )[0]?.q,
      );

    /** O que este arquivo grava fora da massa comum (sai antes dela: aponta para o insumo e o estabelecimento). */
    const limparProprio = (e: Escritor) =>
      (async () => {
        for (const sql of [
          `DELETE FROM regra_fracionamento_insumo WHERE origem_insumo_id IN (SELECT id FROM insumo WHERE codigo LIKE 'F22L0314%')
            OR resultante_insumo_id IN (SELECT id FROM insumo WHERE codigo LIKE 'F22L0314%')`,
          `DELETE FROM atendimento WHERE paciente_id IN (SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE '%${NOME}')`,
          `DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
          `DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
          `DELETE FROM pessoa_fisica WHERE nome LIKE '%${NOME}'`,
          "DELETE FROM categoria_atendimento WHERE codigo LIKE 'F22L0314%RLCA'",
          "DELETE FROM fonte_pagadora WHERE codigo LIKE 'F22L0314%RLOP'",
        ])
          await e.executar(sql, []);
      })();

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      await nucleo.escrever(ctxE, limparProprio);
      m = await montarMassa(nucleo);
      unit = new PortaUnitarizacaoDosePropria(nucleo);
      manip = new PortaManipulacaoPropria(nucleo);
      await nucleo.escrever(ctxE, async (e) => {
        const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
        ids.loteSem = await x('lote_insumo', {
          estabelecimento_id: m.estA,
          insumo_id: m.insumo,
          numero_lote: `${m.marca}SVP`,
          validade: null,
          situacao: 'liberado',
          origem: 'migracao',
        });
        await x('saldo_lote', {
          estabelecimento_id: m.estA,
          local_estoque_id: m.localA,
          lote_insumo_id: ids.loteSem,
          quantidade: 3,
          competencia: '2026-11-01',
        });
        ids.dose = await x('insumo', {
          codigo: `${m.marca}RLSVPD`,
          nome: 'DOSE SINTETICA RLSVP',
          tipo: 'material',
          grupo_insumo_id: m.grupo,
          estoque_unidade_medida_id: m.unidade,
          situacao: 'ativo',
        });
        const pessoa = (nome: string) => x('pessoa_fisica', { nome: `${nome} ${NOME}` });
        const paciente = await x('paciente', {
          pessoa_fisica_id: await pessoa('PACIENTE'),
          numero_prontuario: 926_000_000 + (Date.now() % 900_000),
        });
        const medico = await x('profissional', {
          pessoa_fisica_id: await pessoa('MEDICO'),
          tipo: 'corpo_clinico',
        });
        const carater =
          Number(
            (await e.uma<{ id: unknown }>('SELECT id FROM carater_atendimento_tiss ORDER BY id LIMIT 1', []))
              ?.id ?? 0,
          ) || (await x('carater_atendimento_tiss', { codigo_tiss: `${m.marca}`.slice(-2) }));
        ids.atendimento = await x('atendimento', {
          estabelecimento_id: m.estA,
          paciente_id: paciente,
          categoria_atendimento_id: await x('categoria_atendimento', {
            codigo: `${m.marca}RLCA`,
            tipo_base: 'internacao',
          }),
          carater_atendimento_tiss_id: carater,
          fonte_pagadora_id: await x('fonte_pagadora', {
            codigo: `${m.marca}RLOP`,
            tipo: 'operadora',
            situacao: 'ativa',
          }),
          profissional_id: medico,
        });
      });
    }, 120_000);

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever(ctxE, limparProprio);
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    });

    it('unitarização: a ordem com o lote migrado sem validade é recusada com "lote sem validade"; nada gravado', async () => {
      const c = contexto(m, m.estA, 't-rlsvp-unit');
      const regra = await unit.salvarRegra(
        c,
        {
          origem: m.insumo,
          resultante: ids.dose!,
          quantidadeOrigem: 1,
          rendimento: 4,
          unidade: m.unidade,
          validadeHoras: null,
          exigeCapela: false,
          reaproveitaSobra: true,
        },
        chave(),
      );
      const r = await recusaDe(
        unit.executarOrdem(
          c,
          {
            regra: regra.id,
            tipo: 'fracionamento',
            local: m.localA,
            lote: ids.loteSem!,
            capela: null,
            quantidadeOrigem: 1,
            doses: 4,
            perda: 0,
            rupturaLacre: true,
            percentualEstabilidade: null,
            observacao: null,
          },
          chave(),
        ),
      );
      expect(r.codigo).toBe('lote-sem-validade');
      expect(r.campos).toEqual(['lote']);
      expect(r.detalhe).toMatch(/sem validade \(não informada na origem\)/);
      expect(r.detalhe).not.toMatch(/vencid|sem saldo/i);
      const [o] = await ler<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM ordem_unitarizacao WHERE estabelecimento_id = ?',
        [m.estA],
      );
      expect(Number(o?.n)).toBe(0);
      expect(await saldoDoLote()).toBe(3);
    });

    it('manipulação: a ordem com o lote migrado sem validade é recusada, com ou sem a validade digitada; nada gravado', async () => {
      const c = contexto(m, m.estA, 't-rlsvp-manip');
      const trilha = {
        estabelecimento: null,
        usuario: null,
        acao: 'operacao',
        entidade: 'ordem_manipulacao',
        entidadeId: null,
        dadosDepois: { evento: 'teste' },
        correlacao: null,
      } as unknown as TrilhaDaGravacao;
      const abrir = (validadeInsumo: string) =>
        recusaDe(
          manip.gravarSgh(c, trilha, (g) =>
            g.abrir({
              itemPrescrito: 1,
              avaliacao: 1,
              reg: ids.atendimento!,
              produto: null,
              capela: m.capelaA,
              grupo: m.grupoManipulacao,
              insumo: m.insumo,
              local: m.localA,
              loteInsumo: `${m.marca}SVP`,
              validadeInsumo,
              quantidade: 1,
              dose: '10 mg',
              validadeSobra: null,
              em: '2026-11-20T09:00',
              usuario: 'x',
              chave: chave(),
            } satisfies NovaOrdemManipulacao),
          ),
        );
      for (const validade of ['2027-03-31', '']) {
        const r = await abrir(validade);
        expect(r.codigo).toBe('lote-sem-validade');
        expect(r.campos).toEqual(['loteInsumo']);
        expect(r.detalhe).toMatch(/sem validade \(não informada na origem\)/);
      }
      const [o] = await ler<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM ordem_manipulacao WHERE estabelecimento_id = ?',
        [m.estA],
      );
      expect(Number(o?.n)).toBe(0);
      expect(await saldoDoLote()).toBe(3);
    });
  },
);
