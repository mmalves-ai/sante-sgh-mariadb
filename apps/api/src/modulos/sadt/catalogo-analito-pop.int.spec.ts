// Contrato de efeito do cadastro do analito e do procedimento operacional do exame (F3.5, 05-SADT linhas 1 e 3) contra
// o MariaDB real (cliente de teste, massa SINTÉTICA). Prova o que fica no banco: o analito incluído e alterado só no
// enviado (trava pela versão), o código único, a regra do domínio recusando antes de gravar (limite aceito invertido,
// calculado que para na digitação), a inativação sem apagar; o procedimento operacional que nasce em rascunho na versão
// 1, passa à revisão e é aprovado pelo profissional da conta da sessão (nunca escolhido), o aprovado que não muda de
// conteúdo, a versão 2 que ao ser aprovada torna obsoleta a 1 com a vigência encerrada na véspera (nada apagado), o
// código de documento de outro exame recusado; e a trilha de cada gravação.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { type ContextoCatalogo, PortaCatalogoSadtPropria } from './catalogo-porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const detalheDe = (e: unknown) =>
  e instanceof ErroOperacao ? String(e.problema['detail'] ?? '') : String(e);
const somaDias = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const falhaDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return `${codigoDe(e)} ${detalheDe(e)}`;
  }
};

describe.skipIf(SEM_BANCO)(`analito e procedimento operacional (MariaDB, cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let porta: PortaCatalogoSadtPropria;
  let m: MassaSadt | null = null;
  const analitos: number[] = [];
  let n = 0;
  const c = (comUsuario = true): ContextoCatalogo => ({
    cliente: CLIENTE,
    estabelecimento: m?.base.est ?? null,
    usuario: comUsuario ? (m?.base.usuario ?? null) : null,
    correlacao: 't-catalogo-pop',
    chaveIdempotencia: `t-cap-${m?.marca}-${++n}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-catalogo-pop' }, (l) => l.uma(sql, p));
  const trilhas = async (entidade: string, id: number) =>
    Number(
      (
        await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
          entidade,
          id,
        ])
      )?.['n'],
    );
  const linha = (tabela: string, id: number) => um(`SELECT * FROM ${tabela} WHERE id = ?`, [id]);
  let hoje = '';

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'CAP');
    porta = new PortaCatalogoSadtPropria(nucleo);
    hoje = String((await um('SELECT DATE_FORMAT(CURRENT_DATE, "%Y-%m-%d") AS d', []))?.['d']);
  }, 60_000);
  afterAll(async () => {
    if (m) {
      const mm = m;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-catalogo-pop' }, async (e) => {
        await e.executar('DELETE FROM procedimento_operacional_exame WHERE exame_id IN (?, ?)', [
          mm.exameLab,
          mm.exameImagem,
        ]);
        if (analitos.length)
          await e.executar(
            `DELETE FROM analito WHERE id IN (${analitos.map(() => '?').join(',')})`,
            analitos,
          );
      });
    }
    await limparMassaSadt(nucleo, m);
  }, 60_000);

  it('analito: inclui, recusa pela regra e pelo código, altera só o enviado e inativa sem apagar', async () => {
    const mm = m as MassaSadt;
    const base = {
      codigo: `${mm.marca}GLI`,
      nome: 'Glicose de teste',
      sigla: 'GLI',
      tipoResultado: 'numerico',
      casasDecimais: 0,
      limiteMinimoAceito: 1,
      limiteMaximoAceito: 2000,
    };
    const a = await porta.salvarAnalito(c(), null, base);
    analitos.push(a.id);
    expect(a.versao).toBe(1);
    const gravado = await linha('analito', a.id);
    expect(gravado?.['nome']).toBe('Glicose de teste');
    expect(Number(gravado?.['limite_maximo_aceito'])).toBe(2000);
    expect(await trilhas('analito', a.id)).toBe(1);

    expect(await falhaDe(porta.salvarAnalito(c(), null, base))).toMatch(/^regra-catalogo .*código/);
    expect(
      await falhaDe(
        porta.salvarAnalito(c(), null, {
          ...base,
          codigo: `${mm.marca}X`,
          limiteMinimoAceito: 10,
          limiteMaximoAceito: 5,
        }),
      ),
    ).toMatch(/^regra-catalogo limiteMaximoAceito/);
    expect(
      await falhaDe(
        porta.salvarAnalito(c(), null, { ...base, codigo: `${mm.marca}Y`, tipoResultado: 'calculado' }),
      ),
    ).toMatch(/^regra-catalogo pulaNaDigitacao/);
    const semNovo = await um('SELECT COUNT(*) AS n FROM analito WHERE codigo IN (?, ?)', [
      `${mm.marca}X`,
      `${mm.marca}Y`,
    ]);
    expect(Number(semNovo?.['n'])).toBe(0);

    // Alteração: só o nome; o resto continua. Versão vencida é recusada.
    const alt = await porta.salvarAnalito(c(), a.id, { versao: 1, nome: 'Glicose plasmática' });
    expect(alt.versao).toBe(2);
    const depois = await linha('analito', a.id);
    expect(depois?.['nome']).toBe('Glicose plasmática');
    expect(depois?.['sigla']).toBe('GLI');
    expect(Number(depois?.['casas_decimais'])).toBe(0);
    expect(await falhaDe(porta.salvarAnalito(c(), a.id, { versao: 1, nome: 'Outra' }))).not.toBe('gravou');
    // A alteração que tornaria o analito inválido (limite mínimo acima do máximo gravado) é recusada.
    expect(await falhaDe(porta.salvarAnalito(c(), a.id, { versao: 2, limiteMinimoAceito: 5000 }))).toMatch(
      /^regra-catalogo limiteMaximoAceito/,
    );

    await porta.salvarAnalito(c(), a.id, { versao: 2, ativo: false });
    const inativo = await linha('analito', a.id);
    expect(Number(inativo?.['ativo'])).toBe(0);
    expect(inativo?.['excluido_em']).toBeNull();
    expect(await trilhas('analito', a.id)).toBe(3);
    const lista = await porta.analitos(c(), `${mm.marca}GLI`);
    expect(lista.map((x) => x['id'])).toEqual([a.id]);
    expect(lista[0]?.['ativo']).toBe(false);
  });

  it('procedimento operacional: rascunho, revisão, aprovação pela conta, aprovado imutável, v2 torna a v1 obsoleta', async () => {
    const mm = m as MassaSadt;
    const doc = `POP-${mm.marca}`;
    const v1 = await porta.salvarProcedimento(c(), mm.exameLab, {
      codigoDocumento: doc,
      titulo: 'Dosagem de glicose',
      metodologia: 'Enzimático colorimétrico',
    });
    let l = await linha('procedimento_operacional_exame', v1.id);
    expect(l?.['situacao']).toBe('rascunho');
    expect(Number(l?.['versao_documento'])).toBe(1);
    expect(l?.['tipo']).toBe('exame');
    expect(Number(l?.['elaborado_por_usuario_id'])).toBe(mm.base.usuario);

    // Não pula a revisão; sem a conta da sessão não grava.
    expect(
      await falhaDe(
        porta.salvarProcedimento(c(), mm.exameLab, {
          id: v1.id,
          versao: 1,
          situacao: 'aprovado',
          vigenciaInicio: hoje,
        }),
      ),
    ).toMatch(/^regra-catalogo situacao/);
    expect(
      await falhaDe(
        porta.salvarProcedimento(c(false), mm.exameLab, { codigoDocumento: 'X1', titulo: 'Sem conta' }),
      ),
    ).toMatch(/^sem-usuario/);

    await porta.salvarProcedimento(c(), mm.exameLab, { id: v1.id, versao: 1, situacao: 'em_revisao' });
    // Aprovar exige a vigência (domínio) e grava quem aprova pela conta da sessão.
    expect(
      await falhaDe(
        porta.salvarProcedimento(c(), mm.exameLab, { id: v1.id, versao: 2, situacao: 'aprovado' }),
      ),
    ).toMatch(/^regra-catalogo vigenciaInicio/);
    await porta.salvarProcedimento(c(), mm.exameLab, {
      id: v1.id,
      versao: 2,
      situacao: 'aprovado',
      vigenciaInicio: hoje,
    });
    l = await linha('procedimento_operacional_exame', v1.id);
    expect(l?.['situacao']).toBe('aprovado');
    expect(Number(l?.['aprovado_por_profissional_id'])).toBe(mm.base.profissional);
    expect(l?.['aprovado_em']).not.toBeNull();

    // O aprovado não muda de conteúdo.
    expect(
      await falhaDe(
        porta.salvarProcedimento(c(), mm.exameLab, { id: v1.id, versao: 3, titulo: 'Outro título' }),
      ),
    ).toMatch(/^regra-catalogo situacao/);
    // O código do documento é de um exame só.
    expect(
      await falhaDe(
        porta.salvarProcedimento(c(), mm.exameImagem, { codigoDocumento: doc, titulo: 'Outro exame' }),
      ),
    ).toMatch(/^regra-catalogo codigoDocumento/);

    // Versão 2: nasce em rascunho com o número seguinte; aprovada amanhã, encerra a 1 hoje (véspera), sem apagar.
    const v2 = await porta.salvarProcedimento(c(), mm.exameLab, {
      codigoDocumento: doc,
      titulo: 'Dosagem de glicose (revisão)',
      metodologia: 'Hexoquinase',
    });
    expect(Number((await linha('procedimento_operacional_exame', v2.id))?.['versao_documento'])).toBe(2);
    expect(
      await falhaDe(porta.salvarProcedimento(c(), mm.exameLab, { codigoDocumento: doc, titulo: 'Terceira' })),
    ).toMatch(/^regra-catalogo versaoDocumento/);
    await porta.salvarProcedimento(c(), mm.exameLab, { id: v2.id, versao: 1, situacao: 'em_revisao' });
    const amanha = somaDias(hoje, 1);
    const ap = await porta.salvarProcedimento(c(), mm.exameLab, {
      id: v2.id,
      versao: 2,
      situacao: 'aprovado',
      vigenciaInicio: amanha,
      proximaRevisaoEm: somaDias(hoje, 365),
    });
    expect(ap.obsoletas).toEqual([v1.id]);
    l = await linha('procedimento_operacional_exame', v1.id);
    expect(l?.['situacao']).toBe('obsoleto');
    expect(l?.['metodologia']).toBe('Enzimático colorimétrico');
    const fimV1 = l?.['vigencia_fim'] instanceof Date ? l['vigencia_fim'].toISOString().slice(0, 10) : '';
    expect(fimV1).toBe(hoje);

    const ficha = (await porta.ficha(c(), mm.exameLab)) as { procedimentos: Record<string, unknown>[] };
    expect(ficha.procedimentos.map((p) => [p['versaoDocumento'], p['situacao']])).toEqual([
      [2, 'aprovado'],
      [1, 'obsoleto'],
    ]);
    expect(await trilhas('procedimento_operacional_exame', v1.id)).toBeGreaterThanOrEqual(3);
    expect(await trilhas('procedimento_operacional_exame', v2.id)).toBeGreaterThanOrEqual(3);
  });
});
