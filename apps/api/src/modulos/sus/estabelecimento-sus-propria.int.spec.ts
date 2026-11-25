// Contrato de efeito do cadastro SUS do estabelecimento (F7, 06-SUS linha 61) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: dois estabelecimentos com o código do teste; habilitações, serviços, tipo de prestador, grupo e
// serviço da tabela unificada fictícios (vigência de 1999, removidos na limpeza); o usuário é um id já existente do
// cliente (só lido). Prova o que fica no banco: a habilitação com portaria, vigência, leitos e quem gravou; a que o
// catálogo do estabelecimento não tinha entra nele a partir da tabela oficial; as recusas sem gravar (leitos exigidos,
// código desconhecido, sobreposição, fim no meio do mês, versão velha); o encerramento sem apagar; a lista vigente na
// competência; a conciliação com o cadastro nacional (prévia sem gravar; aplicada inclui e encerra na véspera); o
// serviço próprio e o terceirizado sem prestador recusado; as regras por tipo de prestador e do serviço automático; o
// isolamento por estabelecimento. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { habilitacoesNaCompetencia } from '@sgh/dominio-faturamento';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaEstabelecimentoSusPropria } from './estabelecimento-sus-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2123sus';
const P2 = 'c2123sus2';
const FONTE = 'c2123';
const recusa = { problema: { status: 422 } };

async function limpar(e: Escritor): Promise<void> {
  const ests = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  await e.executar(`DELETE FROM habilitacao_estabelecimento WHERE estabelecimento_id IN ${ests}`, [P, P2]);
  await e.executar(`DELETE FROM servico_classificacao_estabelecimento WHERE estabelecimento_id IN ${ests}`, [
    P,
    P2,
  ]);
  await e.executar(`DELETE FROM regra_prestador_sus WHERE estabelecimento_id IN ${ests}`, [P, P2]);
  await e.executar(`DELETE FROM regra_servico_classificacao_sus WHERE estabelecimento_id IN ${ests}`, [
    P,
    P2,
  ]);
  await e.executar("DELETE FROM habilitacao_sus WHERE codigo_cnes IN ('9871', '9872')");
  await e.executar('DELETE FROM habilitacao_sigtap WHERE versao_fonte = ?', [FONTE]);
  await e.executar('DELETE FROM servico_classificacao_sigtap WHERE versao_fonte = ?', [FONTE]);
  await e.executar('DELETE FROM grupo_sigtap WHERE versao_fonte = ?', [FONTE]);
  await e.executar('DELETE FROM dominio_sigtap WHERE versao_fonte = ?', [FONTE]);
  await e.executar('DELETE FROM servico_classificacao WHERE versao_fonte = ?', [FONTE]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaEstabelecimentoSusPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEstabelecimentoSusPropria;
  let m: {
    est: number;
    usuario: number;
    tipo: number;
    grupo: number;
    servSigtap: number;
    serv: number;
    ext: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const habs = () =>
    ler(
      `SELECT he.id, hs.codigo_cnes AS cod, DATE_FORMAT(he.vigencia_inicio, '%Y-%m-%d') AS i,
              DATE_FORMAT(he.vigencia_fim, '%Y-%m-%d') AS f, he.leitos_habilitados AS leitos, he.numero_portaria AS portaria,
              he.versao, he.criado_por
         FROM habilitacao_estabelecimento he JOIN habilitacao_sus hs ON hs.id = he.habilitacao_sus_id
        WHERE he.estabelecimento_id = ? ORDER BY he.id`,
      [m.est],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      const novoEst = (cod: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      await e.inserir(
        `INSERT INTO habilitacao_sigtap (tipo, codigo_habilitacao, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('habilitacao', '9871', 'Habilitação sintética A', '1999-01-01', ?, ?)`,
        [FONTE, agora],
      );
      await e.inserir(
        `INSERT INTO habilitacao_sus (codigo_cnes, descricao, exige_leitos, versao_fonte, criado_em)
         VALUES ('9872', 'Habilitação sintética com leitos', TRUE, ?, ?)`,
        [FONTE, agora],
      );
      const tipo = await e.inserir(
        `INSERT INTO dominio_sigtap (lista, codigo_sigtap, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('tipo_prestador', 'c2123tp', 'Tipo de prestador sintético', '1999-01-01', ?, ?)`,
        [FONTE, agora],
      );
      const grupo = await e.inserir(
        `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('grupo', '98', 'Grupo sintético', '1999-01-01', ?, ?)`,
        [FONTE, agora],
      );
      const servSigtap = await e.inserir(
        `INSERT INTO servico_classificacao_sigtap (codigo_sigtap_servico, descricao_servico, codigo_sigtap_classificacao,
                descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('998', 'Serviço sintético', '001', 'Classificação sintética', '1999-01-01', ?, ?)`,
        [FONTE, agora],
      );
      const serv = await e.inserir(
        `INSERT INTO servico_classificacao (codigo_servico_cnes, codigo_classificacao_cnes, descricao_servico, descricao,
                versao_fonte, criado_em)
         VALUES ('q98', 'q01', 'Serviço sintético', 'Classificação sintética', ?, ?)`,
        [FONTE, agora],
      );
      const ext = await e.uma('SELECT MIN(id) AS id FROM estabelecimento_externo');
      return {
        est,
        usuario: Number(usuario['id']),
        tipo,
        grupo,
        servSigtap,
        serv,
        ext: Number(ext?.['id'] ?? 0),
      };
    });
    porta = new PortaEstabelecimentoSusPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  let comLeitos = 0;
  let daTabela = 0;

  it('inclui a habilitação com leitos e recusa sem gravar os leitos exigidos, o código desconhecido e a sobreposição', async () => {
    await expect(
      porta.incluirHabilitacao(ctx(), { codigo: '9872', vigenciaInicio: '2026-01-01' }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.incluirHabilitacao(ctx(), { codigo: '9879', vigenciaInicio: '2026-01-01' }),
    ).rejects.toMatchObject(recusa);
    expect(await habs()).toEqual([]);
    comLeitos = (
      await porta.incluirHabilitacao(ctx(), {
        codigo: '9872',
        vigenciaInicio: '2026-01-01',
        leitosHabilitados: 10,
        numeroPortaria: 'Portaria sintética 1',
        dataPortaria: '2025-12-15',
      })
    ).id;
    await expect(
      porta.incluirHabilitacao(ctx(), { codigo: '9872', vigenciaInicio: '2026-02-01', leitosHabilitados: 5 }),
    ).rejects.toMatchObject(recusa);
    expect(await habs()).toEqual([
      expect.objectContaining({
        id: comLeitos,
        cod: '9872',
        i: '2026-01-01',
        f: null,
        leitos: 10,
        portaria: 'Portaria sintética 1',
        versao: 1,
        criado_por: m.usuario,
      }),
    ]);
  });

  it('traz ao catálogo do estabelecimento a habilitação da tabela oficial', async () => {
    daTabela = (await porta.incluirHabilitacao(ctx(), { codigo: '9871', vigenciaInicio: '2026-01-01' })).id;
    const cat = await ler(`SELECT descricao, versao_fonte FROM habilitacao_sus WHERE codigo_cnes = '9871'`);
    expect(cat).toEqual([{ descricao: 'Habilitação sintética A', versao_fonte: FONTE }]);
    expect((await habs()).map((h) => h['cod'])).toEqual(['9872', '9871']);
  });

  it('encerra sem apagar e recusa fim no meio do mês e versão velha', async () => {
    await expect(
      porta.encerrarHabilitacao(ctx(), comLeitos, { vigenciaFim: '2026-03-15', versao: 1 }),
    ).rejects.toMatchObject(recusa);
    await porta.encerrarHabilitacao(ctx(), comLeitos, { vigenciaFim: '2026-03-31', versao: 1 });
    await expect(
      porta.encerrarHabilitacao(ctx(), comLeitos, { vigenciaFim: '2026-02-28', versao: 1 }),
    ).rejects.toThrow();
    const h = (await habs()).find((x) => x['id'] === comLeitos)!;
    expect(h).toMatchObject({ f: '2026-03-31', versao: 2 });
    const lista = await porta.habilitacoesCadastradas(ctx());
    expect([...habilitacoesNaCompetencia(lista, '202603')].sort()).toEqual(['9871', '9872']);
    expect([...habilitacoesNaCompetencia(lista, '202604')]).toEqual(['9871']);
  });

  it('concilia com o cadastro nacional: a prévia não grava; aplicada inclui e encerra na véspera', async () => {
    const previa = await porta.conciliarCnes(ctx(), {
      competencia: '202605',
      habilitacoes: [{ codigo: '9872', leitosHabilitados: 8 }],
    });
    expect(previa).toMatchObject({ aplicada: false, mantidas: 0 });
    expect(previa.incluir.map((x) => x.codigo)).toEqual(['9872']);
    expect(previa.encerrar).toEqual([{ id: daTabela, codigo: '9871', vigenciaFim: '2026-04-30' }]);
    expect(await habs()).toHaveLength(2);
    const r = await porta.conciliarCnes(ctx(), {
      competencia: '202605',
      habilitacoes: [{ codigo: '9872', leitosHabilitados: 8 }],
      aplicar: true,
    });
    expect(r.aplicada).toBe(true);
    const depois = await habs();
    expect(depois).toHaveLength(3);
    expect(depois.find((x) => x['id'] === daTabela)).toMatchObject({ f: '2026-04-30' });
    expect(depois[2]).toMatchObject({ cod: '9872', i: '2026-05-01', f: null, leitos: 8 });
  });

  it('serviço próprio grava e encerra; terceirizado sem prestador é recusado', async () => {
    await expect(
      porta.incluirServico(ctx(), {
        servicoClassificacao: m.serv,
        caracteristica: 'terceirizado',
        vigenciaInicio: '2026-01-01',
      }),
    ).rejects.toMatchObject(recusa);
    const { id } = await porta.incluirServico(ctx(), {
      servicoClassificacao: m.serv,
      vigenciaInicio: '2026-01-01',
    });
    await porta.encerrarServico(ctx(), id, { vigenciaFim: '2026-06-30', versao: 1 });
    const s = await ler(
      `SELECT caracteristica, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f, versao, criado_por
         FROM servico_classificacao_estabelecimento WHERE id = ?`,
      [id],
    );
    expect(s).toEqual([{ caracteristica: 'proprio', f: '2026-06-30', versao: 2, criado_por: m.usuario }]);
  });

  it('regras por tipo de prestador e do serviço automático gravam, encerram e inativam sem apagar', async () => {
    await expect(
      porta.incluirRegraPrestador(ctx(), { tipoPrestador: m.tipo, vigenciaInicio: '2026-01-01' }),
    ).rejects.toMatchObject(recusa);
    const rp = await porta.incluirRegraPrestador(ctx(), {
      tipoPrestador: m.tipo,
      servicoClassificacao: m.servSigtap,
      permitido: false,
      vigenciaInicio: '2026-01-01',
    });
    await porta.encerrarRegraPrestador(ctx(), rp.id, { vigenciaFim: '2026-12-31', versao: 1 });
    expect(
      await ler(
        `SELECT estabelecimento_id AS est, permitido, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f FROM regra_prestador_sus
          WHERE id = ?`,
        [rp.id],
      ),
    ).toEqual([{ est: m.est, permitido: 0, f: '2026-12-31' }]);
    await expect(
      porta.incluirRegraServico(ctx(), { servicoClassificacao: m.servSigtap, prioridade: 10 }),
    ).rejects.toMatchObject(recusa);
    const rs = await porta.incluirRegraServico(ctx(), {
      servicoClassificacao: m.servSigtap,
      grupo: m.grupo,
      prioridade: 10,
    });
    await porta.inativarRegraServico(ctx(), rs.id, { versao: 1 });
    await expect(porta.inativarRegraServico(ctx(), rs.id, { versao: 2 })).rejects.toMatchObject(recusa);
    expect(
      await ler(
        'SELECT ativo, prioridade, grupo_sigtap_id AS g FROM regra_servico_classificacao_sus WHERE id = ?',
        [rs.id],
      ),
    ).toEqual([{ ativo: 0, prioridade: 10, g: m.grupo }]);
  });

  it('lista o cadastro do estabelecimento e isola o outro', async () => {
    const c = await porta.listar(ctx());
    expect(c.habilitacoes).toHaveLength(3);
    expect(c.servicos).toHaveLength(1);
    expect(c.regrasPrestador.filter((r) => !r.geral)).toHaveLength(1);
    expect(c.regrasServico).toEqual([
      expect.objectContaining({ servicoClassificacao: '998/001', ativo: false }),
    ]);
    const outro = await porta.listar(ctx(P2));
    expect(outro.habilitacoes).toEqual([]);
    expect(outro.servicos).toEqual([]);
    expect(outro.regrasServico).toEqual([]);
    const op = await porta.opcoes(ctx());
    expect(op.tiposPrestador.some((t) => t.id === m.tipo)).toBe(true);
  });
});
