// Integração C2-122 contra o MariaDB real (cliente f22_o2). Massa sintética "L1221".
// Contrato de efeito: os prazos da resposta lidos do cadastro regulatório semeado pela migração 16_SGO/99 (RN 395: 5 e
// 10 dias úteis), a linha mais nova vigente vencendo a anterior; e a alçada do autorizador (alcada_autorizador_plano
// ligada ao auditor) conferida na decisão pelo serviço: sem negar item, a negativa é recusada e nada muda no pedido; com a
// permissão, a decisão passa. SGH_NUCLEO_SEM_BANCO=1 pula.
import { CODIGO_PRAZO_RESPOSTA, prazoDaRespostaRegulatorio } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import { ServicoAutorizacaoOperadora } from './autorizacao-servico.js';
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

const MARCA = 'L1221 prazo sintético';
/** O código da recusa de negócio do serviço (ErroProblema) ou da porta (ErroOperacao). */
const cod = (e: unknown): string | null =>
  (e as { extras?: { codigo?: string } } | null)?.extras?.codigo ?? codigoDe(e);

describe.skipIf(SEM_BANCO)(
  'C2-122 prazos regulatórios e alçada do autorizador (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaAutorizacaoOperadoraPropria;
    let m: MassaOperadora;
    const ler = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't1221' }, (l) => l.consultar(sql, p));
    const escrever = (sql: string, p: unknown[] = []) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't1221' }, (e) => e.executar(sql, p));
    const limparAlcada = async () => {
      await escrever(
        'UPDATE auditor_plano SET alcada_autorizador_plano_id = NULL WHERE operadora_saude_id = ?',
        [m.operadora],
      );
      await escrever('DELETE FROM alcada_autorizador_plano WHERE operadora_saude_id = ?', [m.operadora]);
      await escrever('DELETE FROM prazo_atendimento_regulatorio WHERE descricao = ?', [MARCA]);
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      m = await prepararMassa(nucleo);
      await limparAlcada();
      await limparNegocio(nucleo, m);
      porta = new PortaAutorizacaoOperadoraPropria(
        nucleo,
        CLIENTE,
        { elegibilidade: async () => null },
        { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      );
    }, 120_000);
    afterAll(async () => {
      if (m) {
        await limparAlcada();
        await limparNegocio(nucleo, m);
      }
      await nucleo?.encerrar();
    });

    it('lê os prazos da resposta do cadastro regulatório; a linha mais nova vigente vence', async () => {
      const lidos = await porta.prazosRegulatorios(contexto(m));
      expect(lidos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ codigo: 'resposta_padrao', prazo: 5, unidade: 'dia_util', ativo: true }),
          expect.objectContaining({
            codigo: 'resposta_complexa',
            prazo: 10,
            unidade: 'dia_util',
            ativo: true,
          }),
        ]),
      );
      const eletivo = { carater: 'E' as const, tipoGuia: m.tipoGuia, altaComplexidade: false };
      // 2026-11-20 é sexta-feira: 5 dias úteis vencem na sexta seguinte; 10, na outra.
      expect(prazoDaRespostaRegulatorio(eletivo, '2026-11-20T10:00:00', lidos)).toEqual({
        tipo: 'padrao',
        prazoEm: '2026-11-27T23:59:59',
        origem: CODIGO_PRAZO_RESPOSTA.padrao,
      });
      expect(
        prazoDaRespostaRegulatorio({ ...eletivo, altaComplexidade: true }, '2026-11-20T10:00:00', lidos)
          .prazoEm,
      ).toBe('2026-12-04T23:59:59');

      // A operadora muda o prazo incluindo outra linha vigente (2 dias corridos desde 01/11).
      await escrever(
        `INSERT INTO prazo_atendimento_regulatorio
              (codigo, descricao, tipo_pedido, carater, prazo, unidade_prazo_id, vigencia_inicio, ativo, criado_em, criado_por)
       SELECT 'resposta_padrao', ?, 'resposta_conclusiva', 'eletivo', 2, u.id, '2026-11-01', TRUE, NOW(3), ?
         FROM unidade_prazo u WHERE u.codigo = 'dia'`,
        [MARCA, m.usuario],
      );
      const novos = await porta.prazosRegulatorios(contexto(m));
      expect(novos.filter((p) => p.codigo === 'resposta_padrao')).toHaveLength(2);
      expect(prazoDaRespostaRegulatorio(eletivo, '2026-11-20T10:00:00', novos).prazoEm).toBe(
        '2026-11-22T23:59:59',
      );
      // Antes do início da linha nova, vale a anterior.
      expect(prazoDaRespostaRegulatorio(eletivo, '2026-10-30T10:00:00', novos).prazoEm).toBe(
        '2026-11-06T23:59:59',
      );
    });

    it('confere a alçada do auditor na decisão: sem negar item recusa e nada muda; com a permissão passa', async () => {
      const conselho = (
        await ler(
          `SELECT cc.sigla, uf.sigla AS uf, ic.numero_inscricao FROM inscricao_conselho ic
           JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
           JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id WHERE ic.profissional_id = ?`,
          [m.profissional],
        )
      )[0]!;
      const aud = await porta.gravar(contexto(m), trilhaTela(m, 'auditor_plano', 'x'), (g) =>
        g.designar({
          operadora: m.operadora,
          login: 'l0209.teste',
          nome: 'x',
          categoria: 'medico',
          conselho: String(conselho['sigla']),
          numero: String(conselho['numero_inscricao']),
          uf: String(conselho['uf']),
          inicio: '2026-01-01',
          usuario: 'x',
        }),
      );
      expect(await porta.alcadaDoAuditor(contexto(m), aud.id)).toEqual({ alcada: null, limite: null });
      await escrever(
        `INSERT INTO alcada_autorizador_plano
              (operadora_saude_id, usuario_id, nivel, tipo_autorizador, valor_limite, autoriza_guia, nega_item,
               vigencia_inicio, ativo, criado_em, criado_por)
       VALUES (?, ?, 1, 'medico', 500.00, TRUE, FALSE, '2026-01-01', TRUE, NOW(3), ?)`,
        [m.operadora, m.usuario, m.usuario],
      );
      const [al] = await ler('SELECT id FROM alcada_autorizador_plano WHERE operadora_saude_id = ?', [
        m.operadora,
      ]);
      await escrever(
        'UPDATE auditor_plano SET alcada_autorizador_plano_id = ?, valor_limite_alcada = 800 WHERE id = ?',
        [al!['id'], aud.id],
      );
      expect(await porta.alcadaDoAuditor(contexto(m), aud.id)).toEqual({
        limite: 800,
        alcada: expect.objectContaining({
          nivel: 1,
          valorLimite: 500,
          autorizaGuia: true,
          negaItem: false,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          ativo: true,
        }),
      });

      const r = await porta.gravar(contexto(m), trilhaTela(m, 'pedido_autorizacao_plano', 'x'), (g) =>
        g.registrar({
          operadora: m.operadora,
          beneficiario: m.beneficiario,
          carteirinha: 'L12210001',
          prestador: m.prestador,
          executante: null,
          guiaPrincipal: null,
          tipoGuia: m.tipoGuia,
          carater: 'E',
          altaComplexidade: false,
          origem: m.origemGuia,
          protocolo: 'L1221-A1',
          solicitadaEm: new Date().toISOString(),
          prazoTipo: 'padrao',
          prazoEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          cid: null,
          indicacaoClinica: 'Indicação clínica sintética',
          profissional: { nome: 'MEDICO SINTETICO', conselho: 'CRM', numero: '912211', uf: 'SP' },
          internacao: null,
          itens: [],
          usuario: 'l1221.teste',
          criticas: [],
        }),
      );
      await escrever('UPDATE pedido_autorizacao_plano SET auditor_plano_id = ? WHERE id = ?', [aud.id, r.id]);
      const servico = new ServicoAutorizacaoOperadora(porta);
      const critica = (await porta.dominios(contexto(m))).critica[0]!.codigo;
      const negar = {
        decisao: 'negar',
        itens: [],
        diariasAutorizadas: null,
        critica,
        fundamento: 'Cláusula 9 do contrato',
      } as unknown as Parameters<ServicoAutorizacaoOperadora['conferirDecisao']>[2];
      const antes = await ler('SELECT situacao, versao FROM pedido_autorizacao_plano WHERE id = ?', [r.id]);
      const erro = await servico.conferirDecisao(contexto(m), r.id, negar, 'l0209.teste', false).then(
        () => null,
        (x: unknown) => x,
      );
      expect(cod(erro)).toBe('alcada-nao-nega');
      expect(await ler('SELECT situacao, versao FROM pedido_autorizacao_plano WHERE id = ?', [r.id])).toEqual(
        antes,
      );
      expect(
        await ler('SELECT id FROM negativa_cobertura WHERE pedido_autorizacao_plano_id = ?', [r.id]),
      ).toHaveLength(0);

      await escrever('UPDATE alcada_autorizador_plano SET nega_item = TRUE WHERE id = ?', [al!['id']]);
      const ok = await servico.conferirDecisao(contexto(m), r.id, negar, 'l0209.teste', false);
      expect(ok.resultado.situacao).toBe('negada');
      expect(ok.negativa).not.toBeNull();

      // Alçada vencida: a decisão volta a ser recusada.
      await escrever("UPDATE alcada_autorizador_plano SET vigencia_fim = '2026-01-31' WHERE id = ?", [
        al!['id'],
      ]);
      const vencida = await servico.conferirDecisao(contexto(m), r.id, negar, 'l0209.teste', false).then(
        () => null,
        (x: unknown) => x,
      );
      expect(cod(vencida)).toBe('alcada-fora-da-vigencia');
    });
  },
);
