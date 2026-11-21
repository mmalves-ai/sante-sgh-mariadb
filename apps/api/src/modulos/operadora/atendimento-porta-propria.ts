// Porta PRÓPRIA do atendimento ao beneficiário e do portal do prestador (F2.2, lote 02-09) sobre o MariaDB do cliente,
// pelo @sgh/nucleo:
//   - protocolo = protocolo_beneficiario (número regulatório, origem, motivo do contato, prazo e situação), com os
//     andamentos em protocolo_beneficiario_andamento e a resposta conclusiva em protocolo_beneficiario_resposta;
//   - conta do portal do prestador = conta_portal_prestador (a senha e o segundo fator ficam no módulo de
//     administração, nunca nesta tabela);
//   - consulta de elegibilidade do portal = consulta_elegibilidade_recebida;
//   - domínios pelo id do registro (origem_protocolo, funcao_portal_prestador, motivo_contato_beneficiario);
//   - beneficiário (elegibilidade e vias da carteirinha) e prestador vêm das portas da F1 e da rede.
// Número de negócio: `protocolo_atendimento` (por estabelecimento).
// Dado da rede inteira: os domínios. Protocolos, contas do portal e consultas filtram pelo estabelecimento da sessão
// (a conta do portal, pela operadora que atua nele).
// Melhoria: o protocolo encerrado ou cancelado guarda quando (CHECK); a resposta por e-mail exige o destinatário
// (CHECK); o login do portal é único por operadora (UNIQUE).
// Pendente (pedido ao orquestrador): registro do protocolo (instância, natureza, classe, canal, assunto, NIP, escrita e
// reanálise ainda sem coluna), interação, prorrogação, resposta por escrito, reanálise, credenciais e tentativas do
// portal (identidade no módulo de administração) e anexos da resposta do prestador respondem 501 `modelo-pendente`.
import { type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  BasePortaOperadoraPropria,
  data,
  exigirOperadora,
  inexistente,
  instante,
  type NucleoOperadora,
  num,
  numOuNulo,
  pendente,
  txt,
  txtOuNulo,
  versaoDe,
} from './apoio-porta-propria.js';
import type {
  ContextoAtendimento,
  DominiosAtendimento,
  GravadorAtendimento,
  PortaAtendimentoOperadora,
} from './atendimento-porta.js';
import type {
  DadosAcessoPortalParaEntrada,
  DadosAcessoPortalPrestador,
  DadosConsultaElegibilidade,
  DadosConsultaProtocolo,
  DadosElegibilidadeBeneficiario,
  DadosEventoProtocolo,
  DadosProtocolo,
  DadosProtocoloResumo,
  DadosReanalise,
  DadosRespostaPrestador,
  FiltroProtocolosPorta,
  SituacaoProtocoloPorta,
  TotaisProtocolos,
} from './dados-portas.js';
import { LIMITE_PAGINA_PROTOCOLOS } from './dados-portas.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora, Prestador } from './rede-porta.js';

export const TABELAS_ATENDIMENTO = [
  'protocolo_beneficiario',
  'protocolo_beneficiario_andamento',
  'protocolo_beneficiario_resposta',
  'conta_portal_prestador',
  'consulta_elegibilidade_recebida',
] as const;

const SITUACAO_DO_BANCO: Readonly<Record<string, SituacaoProtocoloPorta>> = {
  aberto: 'aberto',
  em_andamento: 'em-analise',
  aguardando_solicitante: 'em-analise',
  respondido: 'respondido',
  encerrado: 'encerrado',
  cancelado: 'cancelado',
};
const SITUACOES_DA_TELA: Readonly<Record<SituacaoProtocoloPorta, readonly string[]>> = {
  aberto: ['aberto'],
  'em-analise': ['em_andamento', 'aguardando_solicitante'],
  respondido: ['respondido'],
  encerrado: ['encerrado'],
  cancelado: ['cancelado'],
};
const SITUACAO_CONTA: Readonly<Record<string, DadosAcessoPortalPrestador['situacao']>> = {
  convidada: 'pendente',
  ativa: 'ativo',
  bloqueada: 'ativo',
  encerrada: 'encerrado',
};
const MEIOS = ['email', 'carta', 'portal', 'aplicativo', 'mensagem', 'telefone', 'presencial'] as const;

const SELECT_PROTOCOLO = `
  SELECT p.*, op.codigo AS origem_codigo, mc.codigo AS motivo_codigo, mc.descricao AS motivo_descricao,
         mc.tipo_contato, pf.nome AS beneficiario_nome, b.matricula, oe.operadora_saude_id AS operadora_vinculada,
         pa.protocolo AS autorizacao_protocolo, pa.situacao AS autorizacao_situacao,
         (SELECT r.resposta FROM protocolo_beneficiario_resposta r WHERE r.protocolo_beneficiario_id = p.id
           ORDER BY r.sequencia DESC LIMIT 1) AS resposta,
         (SELECT r.meio_envio FROM protocolo_beneficiario_resposta r WHERE r.protocolo_beneficiario_id = p.id
           ORDER BY r.sequencia DESC LIMIT 1) AS resposta_meio,
         (SELECT r.criado_em FROM protocolo_beneficiario_resposta r WHERE r.protocolo_beneficiario_id = p.id
           ORDER BY r.sequencia DESC LIMIT 1) AS respondido_em,
         (SELECT u.login FROM protocolo_beneficiario_resposta r JOIN usuario u ON u.id = r.respondido_por_usuario_id
           WHERE r.protocolo_beneficiario_id = p.id ORDER BY r.sequencia DESC LIMIT 1) AS respondido_por
    FROM protocolo_beneficiario p
    JOIN origem_protocolo op ON op.id = p.origem_protocolo_id
    JOIN motivo_contato_beneficiario mc ON mc.id = p.motivo_contato_beneficiario_id
    LEFT JOIN beneficiario_plano b ON b.id = p.beneficiario_plano_id
    LEFT JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
    LEFT JOIN contrato_plano k ON k.id = b.contrato_plano_id
    LEFT JOIN operadora_saude_estabelecimento oe ON oe.estabelecimento_id = p.estabelecimento_id AND oe.principal = TRUE
         AND oe.excluido_em IS NULL
    LEFT JOIN pedido_autorizacao_plano pa ON pa.id = p.pedido_autorizacao_plano_id`;

function resumoDe(p: Linha, agora: string): DadosProtocoloResumo {
  const situacao = SITUACAO_DO_BANCO[txt(p['situacao'])] ?? 'aberto';
  const prazo = instante(p['prazo_em']) ?? '';
  return {
    id: num(p['id']),
    operadora: num(p['operadora_saude_id'] ?? p['operadora_vinculada']),
    protocolo: txt(p['numero_protocolo']),
    instancia: '',
    natureza: txt(p['tipo_contato']),
    classe: txt(p['motivo_codigo']),
    canal: txt(p['origem_codigo']),
    beneficiario: numOuNulo(p['beneficiario_plano_id']),
    beneficiarioNome: txtOuNulo(p['beneficiario_nome']),
    carteirinha: txtOuNulo(p['matricula']),
    prestador: numOuNulo(p['prestador_rede_id']),
    assunto: txt(p['motivo_descricao']),
    situacao,
    abertoEm: instante(p['aberto_em']) ?? '',
    prazoEm: prazo,
    prorrogadoAte: null,
    vencido: (situacao === 'aberto' || situacao === 'em-analise') && prazo !== '' && prazo < agora,
    escritaPedida: false,
    escritaEnviadaEm: null,
    escritaVencida: false,
    conclusao: null,
    versao: num(p['versao']),
  };
}

export class PortaAtendimentoOperadoraPropria
  extends BasePortaOperadoraPropria<GravadorAtendimento>
  implements PortaAtendimentoOperadora
{
  constructor(
    nucleo: NucleoOperadora,
    cliente: string,
    private readonly f1: Pick<PortaOperadora, 'elegibilidade' | 'vias'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador'>,
  ) {
    super(nucleo, cliente, 'operadora.atendimento', TABELAS_ATENDIMENTO);
  }

  private async agoraDo(l: Leitor): Promise<string> {
    return instante((await l.uma<{ agora: unknown }>('SELECT NOW() AS agora'))?.agora) ?? '';
  }

  // ---- domínios e apoio ----

  async dominios(c: ContextoAtendimento): Promise<DominiosAtendimento> {
    return this.ler(c, async (l) => {
      const lista = async (tabela: string) =>
        (
          await l.consultar(`SELECT id, descricao FROM ${tabela} WHERE ativo = TRUE ORDER BY descricao, id`)
        ).map((x) => ({ id: num(x['id']), rotulo: txt(x['descricao']) }));
      return {
        origem: await lista('origem_protocolo'),
        funcoesPortal: await lista('funcao_portal_prestador'),
        tiposAtendimento: await lista('motivo_contato_beneficiario'),
      };
    });
  }

  elegibilidade(c: ContextoAtendimento, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null> {
    return this.f1.elegibilidade(c, carteirinha) as Promise<DadosElegibilidadeBeneficiario | null>;
  }

  async validadeCarteirinha(c: ContextoAtendimento, beneficiario: number): Promise<string | null> {
    const vias = (await this.f1.vias(c, beneficiario)) as readonly { via: number; validade: string | null }[];
    return [...vias].sort((a, b) => b.via - a.via)[0]?.validade ?? null;
  }

  consultasElegibilidade(c: ContextoAtendimento, prestador: number): Promise<DadosConsultaElegibilidade[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ce.id, ce.numero_carteira, ce.consultado_em, ce.resultado, ce.motivo_inelegibilidade,
                  ce.beneficiario_plano_id, u.login
             FROM consulta_elegibilidade_recebida ce LEFT JOIN usuario u ON u.id = ce.criado_por
            WHERE ce.estabelecimento_id = ? AND ce.prestador_rede_id = ? AND ce.excluido_em IS NULL
            ORDER BY ce.id DESC LIMIT 30`,
          [c.estabelecimento ?? 0, prestador],
        )
      ).map((x) => ({
        id: num(x['id']),
        carteirinha: txt(x['numero_carteira']),
        data: data(x['consultado_em']) ?? '',
        elegivel: txt(x['resultado']) === 'elegivel',
        motivos: txtOuNulo(x['motivo_inelegibilidade'])?.split('|').filter(Boolean) ?? [],
        beneficiario: numOuNulo(x['beneficiario_plano_id']),
        em: instante(x['consultado_em']) ?? '',
        por: txt(x['login']),
      })),
    );
  }

  prestador(c: ContextoAtendimento, id: number): Promise<Prestador | null> {
    return this.rede.prestador(c, id);
  }

  // ---- protocolos ----

  protocolos(
    c: ContextoAtendimento,
    f: FiltroProtocolosPorta,
  ): Promise<{ itens: DadosProtocoloResumo[]; proxima: number | null }> {
    const limite = Math.min(f.limite ?? LIMITE_PAGINA_PROTOCOLOS, LIMITE_PAGINA_PROTOCOLOS);
    const cond = ['p.estabelecimento_id = ?', 'p.excluido_em IS NULL'];
    const p: unknown[] = [c.estabelecimento ?? 0];
    if (f.situacao) {
      const s = SITUACOES_DA_TELA[f.situacao];
      cond.push(`p.situacao IN (${s.map(() => '?').join(', ')})`);
      p.push(...s);
    }
    if (f.natureza) {
      cond.push('mc.tipo_contato = ?');
      p.push(f.natureza);
    }
    if (f.vencidos) cond.push("p.situacao IN ('aberto','em_andamento','aguardando_solicitante') AND p.prazo_em < NOW()");
    if (f.busca) {
      cond.push('(p.numero_protocolo = ? OR b.matricula = ?)');
      p.push(f.busca, f.busca);
    }
    if (f.apos) {
      cond.push('p.id < ?');
      p.push(f.apos);
    }
    return this.ler(c, async (l) => {
      const agora = await this.agoraDo(l);
      const linhas = await l.consultar(`${SELECT_PROTOCOLO} WHERE ${cond.join(' AND ')} ORDER BY p.id DESC LIMIT ${limite + 1}`, p);
      const itens = linhas.slice(0, limite).map((x) => resumoDe(x, agora));
      return { itens, proxima: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  totais(c: ContextoAtendimento): Promise<TotaisProtocolos> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT SUM(situacao = 'aberto') AS abertos,
                SUM(situacao IN ('em_andamento','aguardando_solicitante')) AS em_analise,
                SUM(situacao IN ('aberto','em_andamento','aguardando_solicitante') AND prazo_em < NOW()) AS vencidos,
                (SELECT COUNT(*) FROM protocolo_beneficiario_resposta r JOIN protocolo_beneficiario x
                    ON x.id = r.protocolo_beneficiario_id
                  WHERE x.estabelecimento_id = ? AND DATE(r.criado_em) = CURRENT_DATE) AS hoje
           FROM protocolo_beneficiario WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0, c.estabelecimento ?? 0],
      );
      return {
        abertos: num(t?.['abertos']),
        emAnalise: num(t?.['em_analise']),
        vencidos: num(t?.['vencidos']),
        escritaPendente: 0,
        respondidosHoje: num(t?.['hoje']),
      };
    });
  }

  protocolo(c: ContextoAtendimento, id: number): Promise<DadosProtocolo | null> {
    return this.ler(c, async (l) => {
      const p = await l.uma(`${SELECT_PROTOCOLO} WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      if (!p) return null;
      return {
        ...resumoDe(p, await this.agoraDo(l)),
        origem: num(p['origem_protocolo_id']),
        solicitante: p['beneficiario_plano_id'] ? 'beneficiario' : p['prestador_rede_id'] ? 'prestador' : 'terceiro',
        solicitanteNome: txtOuNulo(p['solicitante_nome']),
        autorizacao: p['pedido_autorizacao_plano_id']
          ? {
              id: num(p['pedido_autorizacao_plano_id']),
              protocolo: txt(p['autorizacao_protocolo']),
              situacao: txt(p['autorizacao_situacao']).replace('_', '-'),
            }
          : null,
        origemProtocolo: null,
        numeroNip: null,
        urgente: false,
        altaComplexidade: false,
        relato: txt(p['detalhe']),
        prazoTipo: 'padrao',
        prorrogacaoMotivo: null,
        resposta: txtOuNulo(p['resposta']),
        fundamento: txtOuNulo(p['consideracao_operadora']),
        meio: txtOuNulo(p['resposta_meio']),
        respondidoEm: instante(p['respondido_em']),
        respondidoPor: txtOuNulo(p['respondido_por']),
        escritaPedidaEm: null,
        escritaPrazoEm: null,
        escritaMeio: null,
        encerradoEm: instante(p['encerrado_em']),
        motivoCancelamento: txt(p['situacao']) === 'cancelado' ? txtOuNulo(p['consideracao_operadora']) : null,
      };
    });
  }

  async reanalises(): Promise<DadosReanalise[]> {
    return [];
  }

  eventos(c: ContextoAtendimento, id: number): Promise<DadosEventoProtocolo[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT a.id, a.tipo, a.acao, a.mensagem, a.inicio_em, u.login, p.situacao
             FROM protocolo_beneficiario_andamento a
             JOIN protocolo_beneficiario p ON p.id = a.protocolo_beneficiario_id
             LEFT JOIN usuario u ON u.id = a.responsavel_usuario_id
            WHERE a.protocolo_beneficiario_id = ? AND p.estabelecimento_id = ? AND a.excluido_em IS NULL
            ORDER BY a.sequencia`,
          [id, c.estabelecimento ?? 0],
        )
      ).map((a) => ({
        id: num(a['id']),
        evento: txt(a['acao']) || txt(a['tipo']),
        situacao: SITUACAO_DO_BANCO[txt(a['situacao'])] ?? 'aberto',
        texto: txtOuNulo(a['mensagem']),
        em: instante(a['inicio_em']) ?? '',
        por: txt(a['login']),
      })),
    );
  }

  consulta(c: ContextoAtendimento, numero: string, prestador?: number): Promise<DadosConsultaProtocolo | null> {
    return this.ler(c, async (l) => {
      const agora = await this.agoraDo(l);
      const p = await l.uma(
        `SELECT id, numero_protocolo, situacao, aberto_em, prazo_em, prestador_rede_id FROM protocolo_beneficiario
          WHERE estabelecimento_id = ? AND numero_protocolo = ? AND excluido_em IS NULL
            ${prestador !== undefined ? 'AND prestador_rede_id = ?' : ''}`,
        prestador !== undefined ? [c.estabelecimento ?? 0, numero, prestador] : [c.estabelecimento ?? 0, numero],
      );
      if (p) {
        const r = resumoDe(p, agora);
        return {
          tipo: 'atendimento',
          id: r.id,
          protocolo: r.protocolo,
          situacao: r.situacao,
          abertoEm: r.abertoEm,
          prazoEm: r.prazoEm,
          vencido: r.vencido,
          prestador: r.prestador,
        };
      }
      const a = await l.uma(
        `SELECT id, protocolo, situacao, solicitada_em, prazo_em, solicitante_prestador_rede_id
           FROM pedido_autorizacao_plano
          WHERE estabelecimento_id = ? AND protocolo = ? AND excluido_em IS NULL
            ${prestador !== undefined ? 'AND solicitante_prestador_rede_id = ?' : ''}`,
        prestador !== undefined ? [c.estabelecimento ?? 0, numero, prestador] : [c.estabelecimento ?? 0, numero],
      );
      if (!a) return null;
      const prazo = instante(a['prazo_em']) ?? '';
      const situacao = txt(a['situacao']).replace('_', '-');
      return {
        tipo: 'autorizacao',
        id: num(a['id']),
        protocolo: txt(a['protocolo']),
        situacao,
        abertoEm: instante(a['solicitada_em']) ?? '',
        prazoEm: prazo,
        vencido: ['em-analise', 'pendente', 'em-junta'].includes(situacao) && prazo < agora,
        prestador: numOuNulo(a['solicitante_prestador_rede_id']),
      };
    });
  }

  /**
   * As respostas do prestador pelo portal: o modelo ainda não guarda a resposta com anexo (armazenamento de arquivos
   * pendente), então não há resposta a listar. A ficha do protocolo abre; só abrir o anexo responde 501.
   */
  async respostasPrestador(): Promise<DadosRespostaPrestador[]> {
    return [];
  }

  async anexoDaResposta(): Promise<{ protocolo: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null> {
    return pendente('Anexo da resposta do prestador (armazenamento de arquivos)');
  }

  // ---- contas do portal do prestador ----

  private contasDoPortal(l: Leitor, est: number, filtro: string, p: unknown[]): Promise<DadosAcessoPortalPrestador[]> {
    return l
      .consultar(
        `SELECT cp.*, pr.nome AS prestador_nome, pf.nome AS operador_nome, fp.codigo AS funcao_codigo
           FROM conta_portal_prestador cp
           JOIN prestador_rede pr ON pr.id = cp.prestador_rede_id
           LEFT JOIN pessoa_fisica pf ON pf.id = cp.operador_pessoa_fisica_id
           LEFT JOIN funcao_portal_prestador fp ON fp.id = cp.funcao_portal_prestador_id
          WHERE cp.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe
                         WHERE oe.operadora_saude_id = cp.operadora_saude_id AND oe.estabelecimento_id = ?
                           AND oe.excluido_em IS NULL)
            ${filtro}
          ORDER BY pr.nome, cp.login`,
        [est, ...p],
      )
      .then((linhas) =>
        linhas.map((x) => ({
          id: num(x['id']),
          operadora: num(x['operadora_saude_id']),
          prestador: num(x['prestador_rede_id']),
          prestadorNome: txt(x['prestador_nome']),
          login: txt(x['login']),
          nome: txt(x['operador_nome'] ?? x['login']),
          funcoes: txt(x['funcao_codigo']),
          tipoAtendimento: 0,
          situacao: SITUACAO_CONTA[txt(x['situacao'])] ?? 'pendente',
          ativacaoValidaAte: null,
          tentativas: num(x['tentativas_falhas']),
          bloqueadoAte: txt(x['situacao']) === 'bloqueada' ? instante(x['bloqueada_em']) : null,
          ultimoAcessoEm: instante(x['ultimo_acesso_em']),
          motivoEncerramento: txt(x['situacao']) === 'encerrada' ? txtOuNulo(x['motivo_bloqueio']) : null,
          versao: num(x['versao']),
        })),
      );
  }

  acessos(c: ContextoAtendimento): Promise<DadosAcessoPortalPrestador[]> {
    return this.ler(c, (l) => this.contasDoPortal(l, c.estabelecimento ?? 0, '', []));
  }

  async acesso(c: ContextoAtendimento, id: number): Promise<DadosAcessoPortalPrestador | null> {
    return (await this.ler(c, (l) => this.contasDoPortal(l, c.estabelecimento ?? 0, 'AND cp.id = ?', [id])))[0] ?? null;
  }

  async acessoParaEntrada(): Promise<DadosAcessoPortalParaEntrada | null> {
    return pendente('Entrada no portal do prestador (credencial no módulo de administração)');
  }

  // ---- gravação ----

  protected gravador(tx: TxOperacao): GravadorAtendimento {
    const est = tx.contexto.estabelecimento ?? 0;
    const protocolo = async (id: number) => {
      const p = await versaoDe(tx, 'protocolo_beneficiario', id, 'O protocolo');
      if (num(p['estabelecimento_id']) !== est) throw inexistente('O protocolo');
      return p;
    };
    const andamento = async (id: number, tipo: string, acao: string, mensagem: string | null) => {
      const seq = num((await tx.uma('SELECT MAX(sequencia) AS s FROM protocolo_beneficiario_andamento WHERE protocolo_beneficiario_id = ?', [id]))?.['s']) + 1;
      await tx.incluir('protocolo_beneficiario_andamento', {
        protocolo_beneficiario_id: id,
        sequencia: seq,
        tipo,
        responsavel_usuario_id: tx.contexto.usuario,
        inicio_em: new Date(),
        acao,
        mensagem,
      });
    };
    const emAberto = (p: Linha) => {
      if (['encerrado', 'cancelado'].includes(txt(p['situacao'])))
        throw recusa('protocolo-encerrado', 'O protocolo já foi encerrado.');
    };
    return {
      proximoProtocolo: async () => (await tx.proximoNumero('protocolo_atendimento')).valor,
      registrar: () => pendente('Registro do protocolo de atendimento (instância, natureza, canal e assunto)'),
      async analisar(a) {
        const p = await protocolo(a.id);
        if (txt(p['situacao']) !== 'aberto') throw recusa('protocolo-em-analise', 'O protocolo já está em análise.');
        const versao = await tx.alterar('protocolo_beneficiario', a.id, a.versao, {
          situacao: 'em_andamento',
          atendente_usuario_id: tx.contexto.usuario,
        });
        await andamento(a.id, 'mudanca_fase', 'analise', null);
        return { id: a.id, versao };
      },
      interagir: () => pendente('Interação no protocolo'),
      prorrogar: () => pendente('Prorrogação do prazo do protocolo'),
      async responder(a) {
        const p = await protocolo(a.id);
        emAberto(p);
        const meio = (MEIOS as readonly string[]).includes(a.meio) ? a.meio : 'portal';
        const seq = num((await tx.uma('SELECT MAX(sequencia) AS s FROM protocolo_beneficiario_resposta WHERE protocolo_beneficiario_id = ?', [a.id]))?.['s']) + 1;
        await tx.incluir('protocolo_beneficiario_resposta', {
          protocolo_beneficiario_id: a.id,
          sequencia: seq,
          resposta: a.resposta,
          conclusiva: true,
          meio_envio: meio,
          enviado_em: new Date(a.respondidoEm),
          respondido_por_usuario_id: tx.contexto.usuario,
        });
        const versao = await tx.alterar('protocolo_beneficiario', a.id, a.versao, {
          situacao: 'respondido',
          consideracao_operadora: a.fundamento,
          retorno_meio: meio,
        });
        await andamento(a.id, 'mudanca_fase', 'resposta', a.conclusao);
        return { id: a.id, versao };
      },
      pedirEscrita: () => pendente('Pedido de resposta por escrito'),
      enviarEscrita: () => pendente('Envio da resposta por escrito'),
      async encerrar(a) {
        const p = await protocolo(a.id);
        emAberto(p);
        const versao = await tx.alterar('protocolo_beneficiario', a.id, a.versao, {
          situacao: 'encerrado',
          encerrado_em: new Date(),
        });
        await andamento(a.id, 'mudanca_fase', 'encerramento', null);
        return { id: a.id, versao };
      },
      async cancelar(a) {
        const p = await protocolo(a.id);
        emAberto(p);
        const versao = await tx.alterar('protocolo_beneficiario', a.id, a.versao, {
          situacao: 'cancelado',
          encerrado_em: new Date(),
          consideracao_operadora: a.motivo,
        });
        await andamento(a.id, 'mudanca_fase', 'cancelamento', a.motivo);
        return { id: a.id, versao };
      },
      reanalise: () => pendente('Reanálise do protocolo'),
      criarAcesso: () => pendente('Criação da conta do portal (ativação no módulo de administração)'),
      alterarAcesso: () => pendente('Alteração da conta do portal (funções múltiplas)'),
      reemitirAcesso: () => pendente('Reemissão da ativação do portal'),
      async encerrarAcesso(a) {
        const cp = await versaoDe(tx, 'conta_portal_prestador', a.id, 'A conta do portal');
        await exigirOperadora(tx, est, num(cp['operadora_saude_id']));
        if (txt(cp['situacao']) === 'encerrada') throw recusa('acesso-encerrado', 'A conta do portal já foi encerrada.');
        const versao = await tx.alterar('conta_portal_prestador', a.id, a.versao, {
          situacao: 'encerrada',
          encerrada_em: new Date(),
          motivo_bloqueio: a.motivo.slice(0, 200),
        });
        return { id: a.id, versao };
      },
      ativarAcesso: () => pendente('Ativação da conta do portal (credencial no módulo de administração)'),
      trocarCredencial: () => pendente('Troca de credencial do portal (módulo de administração)'),
      responderInteracaoPrestador: () => pendente('Resposta do prestador pelo portal (anexos)'),
      async registrarElegibilidade(x) {
        await exigirOperadora(tx, est, x.operadora);
        const id = await tx.incluir('consulta_elegibilidade_recebida', {
          estabelecimento_id: est,
          operadora_saude_id: x.operadora,
          prestador_rede_id: x.prestador,
          canal: 'portal_prestador',
          beneficiario_plano_id: x.beneficiario,
          numero_carteira: x.carteirinha,
          tipo_identificacao: 'carteira',
          consultado_em: new Date(),
          respondido_em: new Date(),
          resultado: x.elegivel ? 'elegivel' : x.beneficiario === null ? 'nao_localizado' : 'inelegivel',
          motivo_inelegibilidade: x.elegivel ? null : x.motivos.join('|').slice(0, 40) || 'sem_motivo',
        });
        return { id };
      },
      tentativaPortal: () => pendente('Tentativas de entrada no portal (módulo de administração)'),
    };
  }
}
