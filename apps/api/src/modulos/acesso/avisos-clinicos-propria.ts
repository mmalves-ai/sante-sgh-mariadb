// Avisos clínicos na central de avisos (F3.5, 05-SADT linha 10), no banco do cliente. O aviso clínico (retificação do
// resultado que a pessoa já tinha visto, laudo retificado, achado crítico do laudo, isolamento) nasce na gravação do
// módulo que o gera (aviso_clinico + aviso_clinico_destinatario); aqui o destinatário o lê na central e dá ciência.
// As regras são as puras de @sgh/dominio-pep (aviso-clinico-caixa.ts). Contrato de efeito:
//   - leitura: os avisos do usuário da sessão no estabelecimento da sessão (destinatário por usuário), sem os
//     cancelados e excluídos e sem a cópia por e-mail (canal 'email', 03-PEP L133), os não cientes e os cientes
//     dos últimos 7 dias; nunca o de outra pessoa;
//   - ciência: no destinatário, lido_em (se ainda não lido), ciente_em, lido_usuario_id e situação 'ciente', com a
//     versão lida; a repetida não grava; o de outra pessoa e o cancelado são recusados sem gravar; nada é apagado.
// A trilha da ciência vai pelo executor (mesma transação).
import {
  avisoClinicoNaCaixa,
  decidirCienciaAvisoClinico,
  type DestinatarioAvisoClinico,
  type EstadoAvisoClinicoCaixa,
  estadoDoAvisoClinico,
  type GravidadeAvisoClinicoCaixa,
  gravidadeDoAvisoClinico,
  linkDoAvisoClinico,
  ordenarCaixaAvisosClinicos,
} from '@sgh/dominio-pep';
import { ErroOperacao } from '@sgh/nucleo';
import {
  type ContextoPortaPropria,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_AVISOS_CLINICOS = Symbol('PORTA_AVISOS_CLINICOS');

const TABELAS = ['aviso_clinico_destinatario'];
const TETO = 100;
const DIAS_CIENTES = 7;

export interface AvisoClinicoDaCaixa {
  /** O id do destinatário (é a ciência dele que se grava). */
  readonly id: number;
  readonly aviso: number;
  readonly titulo: string;
  readonly mensagem: string;
  readonly gravidade: GravidadeAvisoClinicoCaixa;
  readonly modulo: string | null;
  readonly link: string | null;
  readonly estado: EstadoAvisoClinicoCaixa;
  readonly geradoEm: string;
}

export interface CaixaAvisosClinicos {
  readonly avisos: readonly AvisoClinicoDaCaixa[];
  readonly novos: number;
}

const data = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string | Date);
const iso = (v: unknown): string => (data(v)?.toISOString() ?? '').slice(0, 19);

const destinatarioDe = (r: Record<string, unknown>): DestinatarioAvisoClinico => ({
  usuario: numOuNull(r['usuario_id']),
  situacaoAviso: String(r['situacao_aviso']),
  situacaoDestinatario: String(r['situacao']),
  lidoEm: data(r['lido_em']),
  cienteEm: data(r['ciente_em']),
  excluido: r['excluido_em'] !== null && r['excluido_em'] !== undefined,
});

export class PortaAvisosClinicosPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'acesso.avisosClinicos');
  }

  /** Os avisos clínicos do usuário da sessão no estabelecimento da sessão (novos, lidos e cientes recentes). */
  listar(c: ContextoPortaPropria): Promise<CaixaAvisosClinicos> {
    return this.ler(c, 'listar', async (l, est) => {
      if (c.usuario === null) return { avisos: [], novos: 0 };
      const desde = new Date(Date.now() - DIAS_CIENTES * 86_400_000);
      const linhas = await l.consultar(
        `SELECT d.id, d.usuario_id, d.situacao, d.lido_em, d.ciente_em, d.excluido_em,
                a.id AS aviso_id, a.situacao AS situacao_aviso, a.titulo, a.mensagem, a.prioridade, a.modulo_origem,
                a.paciente_id, a.resultado_exame_id, a.gerado_em
           FROM aviso_clinico_destinatario d
           JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
          WHERE d.usuario_id = ? AND a.estabelecimento_id = ? AND d.excluido_em IS NULL AND a.excluido_em IS NULL
            AND a.situacao <> 'cancelado' AND d.situacao <> 'cancelado' AND d.canal <> 'email'
            AND (d.ciente_em IS NULL OR d.ciente_em > ?)
          ORDER BY d.ciente_em IS NOT NULL, a.gerado_em DESC, d.id DESC
          LIMIT ${TETO}`,
        [c.usuario, est.id, desde],
        { teto: TETO },
      );
      const avisos = ordenarCaixaAvisosClinicos(
        linhas
          .filter((r) => avisoClinicoNaCaixa(destinatarioDe(r)))
          .map((r) => ({
            id: num(r['id']),
            aviso: num(r['aviso_id']),
            titulo: String(r['titulo']),
            mensagem: String(r['mensagem']),
            gravidade: gravidadeDoAvisoClinico(String(r['prioridade'])),
            modulo: txtOuNull(r['modulo_origem']),
            link: linkDoAvisoClinico({
              paciente: numOuNull(r['paciente_id']),
              resultado: numOuNull(r['resultado_exame_id']),
            }),
            estado: estadoDoAvisoClinico(destinatarioDe(r)),
            geradoEm: iso(r['gerado_em']),
          })),
      );
      return { avisos, novos: avisos.filter((a) => a.estado === 'novo').length };
    });
  }

  /** A ciência do destinatário (o próprio usuário da sessão); a repetida não grava. */
  ciente(c: ContextoPortaPropria, id: number): Promise<{ id: number; gravou: boolean }> {
    return this.gravar(c, 'pep.avisoclinico.ciente', TABELAS, async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT d.id, d.usuario_id, d.situacao, d.lido_em, d.ciente_em, d.excluido_em, d.versao,
                a.situacao AS situacao_aviso
           FROM aviso_clinico_destinatario d
           JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
          WHERE d.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [id, est.id],
        { teto: 1 },
      );
      if (!r) throw naoEncontrado('Aviso');
      const decisao = decidirCienciaAvisoClinico(destinatarioDe(r), usuario);
      if ('recusa' in decisao) {
        if (decisao.recusa === 'aviso-de-outro-usuario') throw naoEncontrado('Aviso');
        throw new ErroOperacao(
          409,
          'aviso-cancelado',
          'Aviso cancelado',
          'O aviso foi cancelado e não pede ciência.',
        );
      }
      if (!decisao.gravar) return { tabela: 'aviso_clinico_destinatario', id, gravou: false };
      const agora = new Date();
      await tx.alterar('aviso_clinico_destinatario', id, num(r['versao']), {
        lido_em: r['lido_em'] ?? agora,
        lido_usuario_id: usuario,
        ciente_em: agora,
        situacao: 'ciente',
      });
      return { tabela: 'aviso_clinico_destinatario', id, gravou: true };
    }).then((x) => ({ id: x.id as number, gravou: Boolean(x.gravou) }));
  }
}
