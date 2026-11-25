// Contrato de efeito da conferência das contas médicas recebidas (08-SGO linha 105, C1-100) contra o MariaDB real
// (cliente f22_o2). Massa sintética "L0209". Prova o que fica no banco: a regra de crítica cadastrada
// (regra_critica_conta) e a recusa do código repetido; no recebimento, as críticas da guia gravadas em
// critica_conta_recebida (a padrão no nível da guia e a da regra no item, com a glosa automática somada ao item e a guia
// criticada); o parecer da auditoria (auditoria_conta_recebida) e as recusas (médica sem médico designado, glosa sem
// motivo); o demonstrativo entregue (demonstrativo_analise_emitido: a reemissão atualiza o mesmo registro com a versão);
// e a regra tirada de uso sem apagar. Trilha de cada gravação. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaConferenciaContaPropria } from './conta-conferencia-propria.js';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';

describe.skipIf(SEM_BANCO)('conferência das contas recebidas (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let contas: PortaContasOperadoraPropria;
  let porta: PortaConferenciaContaPropria;
  let m: MassaOperadora;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209c' }, (l) => l.consultar(sql, p));
  const T = (tabela: string, ev: string) => trilhaTela(m, tabela, ev);
  const prazo = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  let regra = 0;
  let lote = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    contas = new PortaContasOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      { autorizacoesPorSenha: async () => [], designacoes: async () => [] },
    );
    porta = new PortaConferenciaContaPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
  });

  const entradaRegra = {
    codigo: 'pen l0209',
    descricao: 'Penalidade sintética do prestador',
    tipo: 'penalidade_prestador' as const,
    principal: null,
    relacionado: null,
    prestador: 0,
    motivoGlosa: 0,
    percentual: 10,
    glosaAutomatica: true,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };

  it('cadastra a regra da operadora e recusa o código repetido', async () => {
    const e = { ...entradaRegra, prestador: m.prestador, motivoGlosa: m.motivoGlosa };
    const r = await porta.incluirRegra(
      contexto(m),
      m.operadora,
      e,
      T('regra_critica_conta', 'operadora.conta.regra-critica-incluida'),
    );
    regra = r.id;
    const [x] = await ler(
      'SELECT codigo, tipo_regra, prestador_rede_id, percentual_glosa, glosa_automatica, ativo FROM regra_critica_conta WHERE id = ?',
      [r.id],
    );
    expect(x).toMatchObject({ codigo: 'PEN-L0209', tipo_regra: 'penalidade_prestador', ativo: 1 });
    expect(Number(x!['percentual_glosa'])).toBe(10);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'regra_critica_conta' AND entidade_id = ?",
        [r.id],
      ),
    ).toHaveLength(1);
    await expect(
      porta.incluirRegra(contexto(m), m.operadora, e, T('regra_critica_conta', 'x')),
    ).rejects.toMatchObject({ problema: { codigo: 'codigo-repetido' } });
    expect((await porta.regras(contexto(m), m.operadora)).map((y) => y.codigo)).toEqual(['PEN-L0209']);
  });

  it('o recebimento grava as críticas: a padrão na guia e a da regra no item, com a glosa somada', async () => {
    const r = await contas.gravar(
      contexto(m),
      T('lote_conta_recebida', 'operadora.contas.recebida'),
      async (g) => {
        const protocolo = await g.proximoProtocolo();
        return g.receber({
          operadora: m.operadora,
          prestador: m.prestador,
          protocolo: `L0209-K${protocolo}`,
          numeroLote: '910001',
          tipoGuia: 'sp-sadt',
          competencia: '2026-10',
          prazoPagamento: prazo,
          arquivo: { nome: 'lote.xml', bytes: 10, sha256: 'hk910001', base64: '', hashEpilogo: 'ek910001' },
          apresentado: 200,
          guias: [
            {
              ordem: 1,
              numeroGuiaPrestador: 'GK910001',
              numeroGuiaOperadora: null,
              senha: null,
              carteirinha: 'L02090001',
              beneficiario: m.beneficiario,
              autorizacao: null,
              carater: '1',
              inicio: '2026-10-05',
              fim: '2026-10-05',
              criticas: ['carteira-invalida'],
              apresentado: 200,
              itens: [
                {
                  ordem: 1,
                  sequencial: 1,
                  grupo: 'procedimento',
                  codigoDespesa: null,
                  tabela: '22',
                  codigo: '90209001',
                  descricao: 'PROCEDIMENTO SINTETICO',
                  data: '2026-10-05',
                  quantidade: 1,
                  fator: 1,
                  valorUnitario: 200,
                  apresentado: 200,
                  glosado: 0,
                  motivo: null,
                  justificativa: null,
                  critica: null,
                },
              ],
            },
          ],
          texto: 'recebida',
          usuario: 'x',
        });
      },
    );
    lote = r.id;
    const crit = await ler(
      `SELECT c.sequencia, c.guia_conta_recebida_item_id IS NOT NULL AS no_item, c.regra_critica_conta_id,
              c.tipo_ocorrencia, c.forma_registro
         FROM critica_conta_recebida c JOIN guia_conta_recebida g ON g.id = c.guia_conta_recebida_id
        WHERE g.lote_conta_recebida_id = ? ORDER BY c.sequencia`,
      [lote],
    );
    expect(crit).toEqual([
      {
        sequencia: 1,
        no_item: 0,
        regra_critica_conta_id: null,
        tipo_ocorrencia: 'critica',
        forma_registro: 'automatica',
      },
      {
        sequencia: 2,
        no_item: 1,
        regra_critica_conta_id: regra,
        tipo_ocorrencia: 'glosa',
        forma_registro: 'automatica',
      },
    ]);
    const [g] = await ler(
      `SELECT g.situacao, g.valor_glosado, i.valor_glosado AS item_glosado, i.valor_liberado
         FROM guia_conta_recebida g JOIN guia_conta_recebida_item i ON i.guia_conta_recebida_id = g.id
        WHERE g.lote_conta_recebida_id = ?`,
      [lote],
    );
    expect(g!['situacao']).toBe('criticada');
    expect([Number(g!['valor_glosado']), Number(g!['item_glosado']), Number(g!['valor_liberado'])]).toEqual([
      20, 20, 180,
    ]);
    const c = await porta.conferencia(contexto(m), lote);
    expect(c.criticas.map((x) => [x.tipo, x.regra?.codigo ?? null, x.itemCodigo])).toEqual([
      ['critica', null, null],
      ['glosa', 'PEN-L0209', '90209001'],
    ]);
  });

  it('registra o parecer da auditoria e recusa médica sem médico designado e glosa sem motivo', async () => {
    const [g] = await ler('SELECT id FROM guia_conta_recebida WHERE lote_conta_recebida_id = ?', [lote]);
    const guia = Number(g!['id']);
    const base = {
      guia,
      item: null,
      tipo: 'administrativa' as const,
      resultado: 'liberado' as const,
      parecer: 'Documentação da guia conferida e completa.',
      motivoGlosa: null,
    };
    const tr = T('auditoria_conta_recebida', 'operadora.conta.auditoria-registrada');
    const r = await porta.registrarAuditoria(contexto(m), lote, base, tr);
    const [a] = await ler(
      'SELECT sequencia, tipo_auditoria, resultado, liberado_em IS NOT NULL AS liberado, lancamento_manual FROM auditoria_conta_recebida WHERE id = ?',
      [r.id],
    );
    expect(a).toEqual({
      sequencia: 1,
      tipo_auditoria: 'administrativa',
      resultado: 'liberado',
      liberado: 1,
      lancamento_manual: 1,
    });
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'auditoria_conta_recebida' AND entidade_id = ?",
        [r.id],
      ),
    ).toHaveLength(1);
    await expect(
      porta.registrarAuditoria(contexto(m), lote, { ...base, tipo: 'medica' }, tr),
    ).rejects.toMatchObject({ problema: { codigo: 'auditor-sem-categoria' } });
    await expect(
      porta.registrarAuditoria(contexto(m), lote, { ...base, resultado: 'glosa_parcial' }, tr),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-obrigatorio' } });
    const c = await porta.conferencia(contexto(m), lote);
    expect(c.auditorias.map((x) => [x.tipo, x.resultado])).toEqual([['administrativa', 'liberado']]);
  });

  it('registra o demonstrativo entregue; a reemissão atualiza o mesmo registro com a versão', async () => {
    const tr = T('demonstrativo_analise_emitido', 'operadora.contas.demonstrativo');
    const e = {
      numero: 'L0209K1',
      protocolo: 'L0209K1',
      hash: 'h',
      informado: 200,
      liberado: 180,
      glosa: 20,
    };
    const r1 = await porta.registrarDemonstrativo(contexto(m), lote, e, tr);
    const r2 = await porta.registrarDemonstrativo(contexto(m), lote, { ...e, liberado: 190, glosa: 10 }, tr);
    expect([r1.id === r2.id, r1.versao, r2.versao]).toEqual([true, 1, 2]);
    const linhas = await ler(
      'SELECT versao, valor_informado, valor_liberado, valor_glosa, situacao, prestador_rede_id FROM demonstrativo_analise_emitido WHERE lote_conta_recebida_id = ?',
      [lote],
    );
    expect(linhas).toHaveLength(1);
    expect([
      Number(linhas[0]!['valor_liberado']),
      Number(linhas[0]!['valor_glosa']),
      linhas[0]!['situacao'],
    ]).toEqual([190, 10, 'enviado']);
    expect(Number(linhas[0]!['prestador_rede_id'])).toBe(m.prestador);
    expect((await porta.conferencia(contexto(m), lote)).demonstrativos).toHaveLength(1);
  });

  it('tira a regra de uso sem apagar (as críticas continuam ligadas) e o próximo lote não é mais criticado por ela', async () => {
    const [x] = await ler('SELECT versao FROM regra_critica_conta WHERE id = ?', [regra]);
    await porta.situacaoRegra(
      contexto(m),
      regra,
      Number(x!['versao']),
      false,
      T('regra_critica_conta', 'operadora.conta.regra-critica-situacao'),
    );
    const [y] = await ler('SELECT ativo FROM regra_critica_conta WHERE id = ?', [regra]);
    expect(y!['ativo']).toBe(0);
    expect(
      await ler('SELECT id FROM critica_conta_recebida WHERE regra_critica_conta_id = ?', [regra]),
    ).toHaveLength(1);
    expect((await porta.regras(contexto(m), m.operadora))[0]).toMatchObject({ ativo: false });
  });
});
