// Integração C2-122 contra o MariaDB real (cliente f22_o2). Massa sintética "L1220".
// Contrato de efeito: as críticas automáticas do pedido gravadas por pedido (critica_pedido_autorizacao, pela crítica do
// cadastro semeado na migração 16_SGO/96, em sequência e com a forma automática), a recusa da crítica fora do cadastro
// (nada fica gravado), as regras de cobertura do rol vigentes lidas da operadora (as vencidas ficam de fora) e
// convertidas em críticas pelo domínio, e a negativa formal registrada na decisão negada (negativa_cobertura, RN 395:
// número, fundamento, cláusula, comunicado e situação emitida), sem negativa na autorizada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { criticasDaRegraRol, negativaParaRegistro } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';

const MARCA = 'L1220 regra sintética';

describe.skipIf(SEM_BANCO)(
  'C2-122 críticas por pedido, regras do rol e negativa (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaAutorizacaoOperadoraPropria;
    let m: MassaOperadora;
    let itens: { id: number; codigo: string }[] = [];
    const ler = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't1220' }, (l) => l.consultar(sql, p));
    const escrever = (sql: string, p: unknown[] = []) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't1220' }, (e) => e.executar(sql, p));
    const T = (ev: string) => trilhaTela(m, 'pedido_autorizacao_plano', ev);

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      m = await prepararMassa(nucleo);
      await limparNegocio(nucleo, m);
      await escrever('DELETE FROM regra_cobertura_rol WHERE observacao = ?', [MARCA]);
      itens = (
        await ler('SELECT id, codigo FROM item_faturavel WHERE excluido_em IS NULL ORDER BY id LIMIT 2')
      ).map((r) => ({ id: Number(r['id']), codigo: String(r['codigo']) }));
      expect(itens).toHaveLength(2);
      porta = new PortaAutorizacaoOperadoraPropria(
        nucleo,
        CLIENTE,
        { elegibilidade: async () => null },
        { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      );
    }, 120_000);
    afterAll(async () => {
      if (m) {
        await limparNegocio(nucleo, m);
        await escrever('DELETE FROM regra_cobertura_rol WHERE observacao = ?', [MARCA]);
      }
      await nucleo?.encerrar();
    });

    const registrar = (protocolo: string, criticas: { codigo: string; texto: string; bloqueia: boolean }[]) =>
      porta.gravar(contexto(m), T('operadora.autorizacao.registrada'), (g) =>
        g.registrar({
          operadora: m.operadora,
          beneficiario: m.beneficiario,
          carteirinha: 'L12200001',
          prestador: m.prestador,
          executante: null,
          guiaPrincipal: null,
          tipoGuia: m.tipoGuia,
          carater: 'E',
          altaComplexidade: false,
          origem: m.origemGuia,
          protocolo,
          solicitadaEm: new Date().toISOString(),
          prazoTipo: 'padrao',
          prazoEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          cid: null,
          indicacaoClinica: 'Indicação clínica sintética',
          profissional: { nome: 'MEDICO SINTETICO', conselho: 'CRM', numero: '912200', uf: 'SP' },
          internacao: null,
          itens: [],
          usuario: 'l1220.teste',
          criticas,
        }),
      );

    it('grava as críticas automáticas do registro por pedido, pela crítica do cadastro', async () => {
      const r = await registrar('L1220-A1', [
        { codigo: 'em-carencia', texto: 'Beneficiário em carência.', bloqueia: true },
        { codigo: 'rol-exige-junta', texto: 'O procedimento exige junta médica.', bloqueia: false },
      ]);
      const linhas = await ler(
        `SELECT c.sequencia, a.codigo, c.tipo_ocorrencia, c.forma_registro, c.descricao, c.liberada, c.criado_por
         FROM critica_pedido_autorizacao c JOIN critica_autorizacao a ON a.id = c.critica_autorizacao_id
        WHERE c.pedido_autorizacao_plano_id = ? ORDER BY c.sequencia`,
        [r.id],
      );
      expect(
        linhas.map((x) => [Number(x['sequencia']), x['codigo'], x['tipo_ocorrencia'], x['forma_registro']]),
      ).toEqual([
        [1, 'em-carencia', 'critica', 'automatica'],
        [2, 'rol-exige-junta', 'critica', 'automatica'],
      ]);
      expect(Number(linhas[0]!['liberada'])).toBe(0);
      expect(linhas[1]!['descricao']).toBe('O procedimento exige junta médica.');
      // A ficha do pedido lê as críticas gravadas pela porta (com a liberação manual).
      const lidas = await porta.criticasENegativa(contexto(m), r.id);
      expect(lidas.criticas.map((x) => [x.sequencia, x.codigo, x.forma, x.liberada])).toEqual([
        [1, 'em-carencia', 'automatica', false],
        [2, 'rol-exige-junta', 'automatica', false],
      ]);
      expect(lidas.criticas[0]!.liberadaEm).toBeNull();
      expect(lidas.negativa).toBeNull();
    });

    it('recusa a crítica fora do cadastro e não deixa o pedido gravado', async () => {
      const codigo = await registrar('L1220-A2', [
        { codigo: 'nao-existe-no-cadastro', texto: 'x', bloqueia: true },
      ])
        .then(() => 'gravou')
        .catch((e: unknown) => codigoDe(e));
      expect(codigo).toBe('critica-nao-cadastrada');
      expect(
        await ler('SELECT id FROM pedido_autorizacao_plano WHERE protocolo = ?', ['L1220-A2']),
      ).toHaveLength(0);
    });

    it('lê as regras do rol vigentes da operadora e o domínio as converte em críticas', async () => {
      await escrever(
        `INSERT INTO regra_cobertura_rol (operadora_saude_id, item_faturavel_id, exige_junta, exige_pericia, sexo_permitido,
         idade_minima, quantidade_maxima_solicitacao, observacao, vigencia_inicio, ativo, criado_em)
       VALUES (?, ?, TRUE, FALSE, 'masculino', 18, 1, ?, '2000-01-01', TRUE, NOW(3)),
              (?, ?, FALSE, TRUE, NULL, NULL, NULL, ?, '2000-01-01', TRUE, NOW(3))`,
        [m.operadora, itens[0]!.id, MARCA, m.operadora, itens[1]!.id, MARCA],
      );
      await escrever(
        "UPDATE regra_cobertura_rol SET vigencia_fim = '2000-12-31' WHERE observacao = ? AND item_faturavel_id = ?",
        [MARCA, itens[1]!.id],
      );
      const lidas = await porta.regrasDoRol(
        contexto(m),
        m.operadora,
        m.beneficiario,
        itens.map((i) => i.codigo),
      );
      expect(lidas.regras).toEqual([
        {
          codigo: itens[0]!.codigo,
          noRol: false,
          diretriz: null,
          exigeJunta: true,
          exigePericia: false,
          sexoPermitido: 'masculino',
          idadeMinima: 18,
          idadeMaxima: null,
          quantidadeMaximaSolicitacao: 1,
        },
      ]);
      expect(
        await porta.regrasDoRol(contexto(m), m.operadora + 999_999, m.beneficiario, [itens[0]!.codigo]),
      ).toMatchObject({
        regras: [],
      });
      const criticas = criticasDaRegraRol(lidas.regras, {
        sexo: 'F',
        nascimento: '2015-01-01',
        hoje: '2026-11-25',
        itens: [{ codigo: itens[0]!.codigo, quantidade: 2 }],
      });
      expect(criticas.map((c) => c.codigo)).toEqual([
        'rol-sexo-nao-permitido',
        'rol-idade-fora-da-faixa',
        'rol-quantidade-acima',
        'rol-fora-do-rol',
        'rol-exige-junta',
      ]);
      // Todo código que o domínio produz está no cadastro semeado (a gravação por pedido não recusa).
      const cad = await ler(
        `SELECT codigo FROM critica_autorizacao WHERE codigo IN (${criticas.map(() => '?').join(', ')})`,
        criticas.map((c) => c.codigo),
      );
      expect(cad).toHaveLength(criticas.length);
    });

    it('registra a negativa formal na decisão negada; nenhuma na autorizada', async () => {
      const r = await registrar('L1220-A3', [
        { codigo: 'em-carencia', texto: 'Em carência.', bloqueia: true },
      ]);
      const negativa = negativaParaRegistro({
        situacao: 'negada',
        numeroGuia: 'L1220-A3',
        criticas: ['em-carencia'],
        fundamento: 'Cláusula 9 do contrato',
        comunicado: 'Protocolo L1220-A3. O pedido de autorização foi negado.',
      });
      await porta.gravar(contexto(m), T('operadora.autorizacao.decidida'), (g) =>
        g.decidir({
          id: r.id,
          versao: 1,
          usuario: 'x',
          situacao: 'negada',
          itens: [],
          diarias: null,
          auditor: null as unknown as number,
          critica: m.critica,
          fundamento: 'Cláusula 9 do contrato',
          parecer: 'Negado por carência',
          senha: null,
          senhaValidade: null,
          negativa,
        }),
      );
      const [n] = await ler(
        `SELECT numero, fundamento, clausula_contratual, descricao, situacao, beneficiario_plano_id, estabelecimento_id,
              motivo_decisao_autorizacao_id, criado_por, versao
         FROM negativa_cobertura WHERE pedido_autorizacao_plano_id = ?`,
        [r.id],
      );
      expect(n).toMatchObject({
        numero: 'NEG-L1220-A3',
        fundamento: 'carencia',
        clausula_contratual: 'Cláusula 9 do contrato',
        descricao: 'Protocolo L1220-A3. O pedido de autorização foi negado.',
        situacao: 'emitida',
      });
      expect(Number(n!['beneficiario_plano_id'])).toBe(m.beneficiario);
      expect(Number(n!['estabelecimento_id'])).toBe(m.est);
      expect(Number(n!['motivo_decisao_autorizacao_id'])).toBe(m.critica);
      expect(Number(n!['versao'])).toBe(1);
      // A ficha do pedido lê a negativa emitida pela porta (número, fundamento, entrega ainda sem meio nem data).
      const ficha = await porta.criticasENegativa(contexto(m), r.id);
      expect(ficha.negativa).toMatchObject({
        numero: 'NEG-L1220-A3',
        fundamento: 'carencia',
        clausula: 'Cláusula 9 do contrato',
        situacao: 'emitida',
        meioEntrega: null,
        entregueEm: null,
      });
      expect(ficha.negativa!.emitidaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const a = await registrar('L1220-A4', []);
      await porta.gravar(contexto(m), T('operadora.autorizacao.decidida'), (g) =>
        g.decidir({
          id: a.id,
          versao: 1,
          usuario: 'x',
          situacao: 'autorizada',
          itens: [],
          diarias: null,
          auditor: null as unknown as number,
          critica: null,
          fundamento: null,
          parecer: 'Autorizado',
          senha: `L1220S${Date.now() % 1_000_000}`,
          senhaValidade: '2099-12-31',
          negativa: null,
        }),
      );
      expect(
        await ler('SELECT id FROM negativa_cobertura WHERE pedido_autorizacao_plano_id = ?', [a.id]),
      ).toHaveLength(0);
      expect(
        await ler('SELECT id FROM critica_pedido_autorizacao WHERE pedido_autorizacao_plano_id = ?', [a.id]),
      ).toHaveLength(0);
      expect(await porta.criticasENegativa(contexto(m), a.id)).toEqual({ criticas: [], negativa: null });
    });
  },
);
