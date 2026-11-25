// C2-074 (08-SGO linha 113): contrato de efeito da porta própria do portal do prestador contra o MariaDB real (cliente
// f22_o2, massa sintética "L0209"): o pedido de alteração do próprio cadastro (pedido_web_prestador com o número PW, a
// conta e o prestador), a fila e a decisão (análise, recusa com motivo, cancelamento só pelo dono), os avisos (publicar,
// recorte pelo domínio, retirar sem apagar), as regras de arquivo (incluir e inativar com a data), a trilha na mesma
// transação e as recusas (documento inválido, decidido não volta, versão velha). SGH_NUCLEO_SEM_BANCO=1 pula.
import { avisosDoPrestador, cnpjSintetico } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaPortalPrestadorPedidosPropria } from './portal-prestador-pedidos-propria.js';

describe.skipIf(SEM_BANCO)(
  'porta própria dos pedidos e avisos do portal do prestador (MariaDB, f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaPortalPrestadorPedidosPropria;
    let m: MassaOperadora;
    let tipoPrestador: number | null = null;
    const ler = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'tc2074' }, (l) => l.consultar(sql, p));
    const T = (tabela: string, ev: string) => trilhaTela(m, tabela, ev);
    const limpar = () =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc2074' }, async (e) => {
        await e.executar('DELETE FROM pedido_web_prestador WHERE estabelecimento_id IN (?, ?)', [
          m.est,
          m.outroEst,
        ]);
        await e.executar('DELETE FROM aviso_portal_prestador WHERE estabelecimento_id IN (?, ?)', [
          m.est,
          m.outroEst,
        ]);
        await e.executar('DELETE FROM regra_arquivo_prestador WHERE operadora_saude_id = ?', [m.operadora]);
      });
    const trilhas = async (tabela: string, id: number) =>
      (await ler('SELECT id FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [tabela, id]))
        .length;

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      m = await prepararMassa(nucleo);
      await limpar();
      porta = new PortaPortalPrestadorPedidosPropria(nucleo, CLIENTE);
      tipoPrestador = (await porta.prestador(contexto(m), m.prestador))?.tipoPrestador ?? null;
    }, 120_000);
    afterAll(async () => {
      if (m) await limpar();
      await nucleo?.encerrar();
    });

    const alteracao = (cnpj = cnpjSintetico('445556660001')) => ({
      tipo: 'endereco' as const,
      prestador: m.prestador,
      pessoa: 'juridica' as const,
      nome: 'Prestador sintético L0209',
      cpf: null,
      cnpj,
      conselho: { classe: null, numero: null, uf: null },
      cnes: '7654321',
      banco: { banco: null, agencia: null, conta: null },
      email: 'portal@exemplo.test',
      cep: '01001000',
      detalhes: { endereco: { logradouro: 'Rua Sintética', numero: '10' } },
      conta: null,
      tipoPrestador,
      nomeFantasia: null,
      telefone: null,
    });

    it('registra o pedido de alteração com o número PW, analisa e recusa com motivo; decidido não volta', async () => {
      const r = await porta.registrarPedido(
        contexto(m),
        alteracao(),
        T('pedido_web_prestador', 'operadora.portal.pedido-enviado'),
      );
      expect(r.numero).toBe(`PW${String(r.id).padStart(8, '0')}`);
      const [linha] = await ler(
        'SELECT situacao, tipo_pedido, prestador_rede_id, pessoa, cnpj, cpf, recebido_em, versao, criado_em, JSON_EXTRACT(detalhes, "$.endereco.numero") AS num FROM pedido_web_prestador WHERE id = ?',
        [r.id],
      );
      expect(linha).toMatchObject({
        situacao: 'recebido',
        tipo_pedido: 'endereco',
        pessoa: 'juridica',
        cpf: null,
      });
      expect(Number(linha?.['prestador_rede_id'])).toBe(m.prestador);
      expect(linha?.['criado_em']).not.toBeNull();
      expect(String(linha?.['num'])).toContain('10');

      const fila = await porta.pedidos(contexto(m), { situacao: 'recebido' });
      expect(fila.map((x) => x.id)).toContain(r.id);
      expect((await porta.pedidos(contexto(m), { prestador: m.prestador + 999_999 })).length).toBe(0);

      const a = await porta.decidirPedido(
        contexto(m),
        { id: r.id, versao: r.versao, acao: 'analisar', motivo: null, analista: m.usuario },
        T('pedido_web_prestador', 'operadora.portal.pedido-analisado'),
      );
      expect(a.situacao).toBe('em_analise');
      const semMotivo = await porta
        .decidirPedido(
          contexto(m),
          { id: r.id, versao: a.versao, acao: 'recusar', motivo: '', analista: m.usuario },
          T('pedido_web_prestador', 'x'),
        )
        .catch(codigoDe);
      expect(semMotivo).toBe('recusa-sem-motivo');
      const velha = await porta
        .decidirPedido(
          contexto(m),
          { id: r.id, versao: r.versao, acao: 'aprovar', motivo: null, analista: m.usuario },
          T('pedido_web_prestador', 'x'),
        )
        .catch(codigoDe);
      expect(velha).toBe('conflito-versao');
      const rec = await porta.decidirPedido(
        contexto(m),
        {
          id: r.id,
          versao: a.versao,
          acao: 'recusar',
          motivo: 'Falta o comprovante de endereço',
          analista: m.usuario,
        },
        T('pedido_web_prestador', 'operadora.portal.pedido-decidido'),
      );
      expect(rec.situacao).toBe('recusado');
      const [dec] = await ler(
        'SELECT situacao, motivo_recusa, analisado_em, analisado_por_usuario_id, versao FROM pedido_web_prestador WHERE id = ?',
        [r.id],
      );
      expect(dec).toMatchObject({ situacao: 'recusado', motivo_recusa: 'Falta o comprovante de endereço' });
      expect(dec?.['analisado_em']).not.toBeNull();
      expect(Number(dec?.['versao'])).toBe(rec.versao);
      const deNovo = await porta
        .decidirPedido(
          contexto(m),
          { id: r.id, versao: rec.versao, acao: 'cancelar', motivo: null, analista: null, dono: m.prestador },
          T('pedido_web_prestador', 'x'),
        )
        .catch(codigoDe);
      expect(deNovo).toBe('pedido-ja-decidido');
      expect(await trilhas('pedido_web_prestador', r.id)).toBe(3);
    });

    it('o prestador cancela só o próprio pedido; documento inválido é recusado antes de gravar', async () => {
      const invalido = await porta
        .registrarPedido(contexto(m), alteracao('11222333000100'), T('pedido_web_prestador', 'x'))
        .catch(codigoDe);
      expect(invalido).toBe('cnpj-invalido');
      const r = await porta.registrarPedido(
        contexto(m),
        alteracao(),
        T('pedido_web_prestador', 'operadora.portal.pedido-enviado'),
      );
      const deOutro = await porta
        .decidirPedido(
          contexto(m),
          {
            id: r.id,
            versao: r.versao,
            acao: 'cancelar',
            motivo: null,
            analista: null,
            dono: m.prestador + 1,
          },
          T('pedido_web_prestador', 'x'),
        )
        .catch(codigoDe);
      expect(deOutro).toBe('pedido-inexistente');
      const c = await porta.decidirPedido(
        contexto(m),
        { id: r.id, versao: r.versao, acao: 'cancelar', motivo: null, analista: null, dono: m.prestador },
        T('pedido_web_prestador', 'operadora.portal.pedido-cancelado'),
      );
      expect(c.situacao).toBe('cancelado');
      const outroEst = await porta.pedido(contexto(m, m.outroEst), r.id);
      expect(outroEst).toBeNull();
    });

    it('publica o aviso, o prestador vê pelo recorte e o aviso sai do ar sem ser apagado', async () => {
      const base = {
        tipo: 'comunicado' as const,
        titulo: 'Novo prazo de envio de lotes',
        conteudo: 'Comunicado sintético.',
        documento: null,
        link: null,
        exibirDe: '2026-01-01T00:00:00',
        exibirAte: null,
        tipoPrestador: null,
        prestador: null,
        destaque: false,
      };
      const geral = await porta.publicarAviso(
        contexto(m),
        base,
        T('aviso_portal_prestador', 'operadora.portal.aviso-publicado'),
      );
      const dele = await porta.publicarAviso(
        contexto(m),
        { ...base, titulo: 'Só para ele', prestador: m.prestador, destaque: true },
        T('aviso_portal_prestador', 'operadora.portal.aviso-publicado'),
      );
      const outro = await porta.publicarAviso(
        contexto(m),
        { ...base, titulo: 'Ainda não', exibirDe: '2099-01-01T00:00:00' },
        T('aviso_portal_prestador', 'operadora.portal.aviso-publicado'),
      );
      const inseguro = await porta
        .publicarAviso(
          contexto(m),
          { ...base, tipo: 'link', link: 'http://x.test' },
          T('aviso_portal_prestador', 'x'),
        )
        .catch(codigoDe);
      expect(inseguro).toBe('link-inseguro');
      const agora = await porta.agora(contexto(m));
      const vistos = avisosDoPrestador(
        await porta.avisos(contexto(m)),
        { prestador: m.prestador, tipoPrestador },
        agora,
      );
      expect(vistos.map((x) => x.id)).toEqual([dele.id, geral.id]);
      expect(vistos.map((x) => x.id)).not.toContain(outro.id);
      await porta.retirarAviso(
        contexto(m),
        geral,
        T('aviso_portal_prestador', 'operadora.portal.aviso-retirado'),
      );
      const [l] = await ler('SELECT ativo, versao, excluido_em FROM aviso_portal_prestador WHERE id = ?', [
        geral.id,
      ]);
      expect(Number(l?.['ativo'])).toBe(0);
      expect(Number(l?.['versao'])).toBe(2);
      expect(l?.['excluido_em']).toBeNull();
      expect(await trilhas('aviso_portal_prestador', geral.id)).toBe(2);
      const deNovo = await porta
        .retirarAviso(contexto(m), { id: geral.id, versao: 2 }, T('aviso_portal_prestador', 'x'))
        .catch(codigoDe);
      expect(deNovo).toBe('aviso-retirado');
    });

    it('inclui e inativa a regra de arquivo do tipo de prestador, com a data', async () => {
      const r = await porta.incluirRegra(
        contexto(m),
        {
          operadora: m.operadora,
          tipoPrestador,
          natureza: 'juridica',
          descricao: 'Alvará sanitário',
          obrigatorio: true,
          extensoes: 'pdf',
          tamanhoMaximoKb: 2048,
        },
        T('regra_arquivo_prestador', 'operadora.portal.regra-arquivo'),
      );
      expect((await porta.regras(contexto(m), m.operadora)).find((x) => x.id === r.id)).toMatchObject({
        obrigatorio: true,
        ativo: true,
        extensoes: 'pdf',
      });
      await porta.inativarRegra(
        contexto(m),
        r,
        T('regra_arquivo_prestador', 'operadora.portal.regra-arquivo'),
      );
      const [l] = await ler('SELECT ativo, inativado_em FROM regra_arquivo_prestador WHERE id = ?', [r.id]);
      expect(Number(l?.['ativo'])).toBe(0);
      expect(l?.['inativado_em']).not.toBeNull();
    });
  },
);
