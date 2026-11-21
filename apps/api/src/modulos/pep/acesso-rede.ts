// Acesso cruzado ao prontuário entre os estabelecimentos da rede (M57, etapa 2; ficha, seções 4, 7 e 8, regras 6 e 7;
// cap-07 §7.7.1 e §7.7.3; cap-08 §8.13). Só existe pela regra registrada da DP-42 (chave `rede.acessoCruzado`, ligada
// no estabelecimento da sessão E no do registro, conferida por quem chama e aqui); até a decisão, só o aviso de que há
// atendimentos. Com a regra ligada:
//   - o paciente da sessão precisa estar acessível aqui (vínculo assistencial do M15, quando o estabelecimento o exige);
//   - o registro do outro estabelecimento é achado pelo vínculo ATIVO do MPI da Rede (nunca por nome ou documento);
//   - a leitura é registrada ANTES de qualquer dado, no banco do estabelecimento em que o registro está (regra 7: a
//     Consulta do RES daquele banco, trilha dupla lá), com o estabelecimento de origem, quem e o motivo; sem trilha,
//     sem dado (503);
//   - o que se lê é a linha do tempo do paciente LÁ (o serviço do M23 no contexto do outro banco), com o sigilo da
//     categoria do profissional da sessão, sem abrir documento (o documento do outro estabelecimento não abre daqui).
// Nenhuma transação cruza os bancos: cada leitura e cada registro é do banco de um estabelecimento.
import {
  CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE,
  CHAVE_LIBERACAO_MPI_REDE,
  EVENTOS_AUDITAVEIS,
  type PedidoProntuarioRede,
  type ProntuarioRede,
} from '@sgh/contratos';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import type { PortaRede } from '../rede/porta.js';
import type { ContextoDocs, ProfissionalPep } from './documentos-porta.js';
import type { ServicoDocumentos } from './documentos-servico.js';

/** A sessão vista pelo acesso cruzado (o controlador monta a partir da requisição). */
export interface SessaoAcessoRede {
  readonly rede: string;
  readonly hospital: string;
  /** Contexto do núcleo da sessão (cliente, estabelecimento e usuário por id). */
  readonly porta: ContextoPorta;
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
}

export interface DependenciasAcessoRede {
  readonly rede: Pick<
    PortaRede,
    'estabelecimentos' | 'redeConfigurada' | 'vinculosDoCadastro' | 'cpfDoLogin'
  >;
  readonly documentos: Pick<ServicoDocumentos, 'linhaTempo' | 'exigirPaciente'>;
  /** Registra no banco do estabelecimento do evento (`hospital`): o remoto, na leitura (regra 7). */
  readonly trilha: RegistradorTrilha;
  /** A chave ligada no estabelecimento INTEIRO, com os pré-requisitos dele (o outro lado do acesso). */
  ligadaNoEstabelecimento(rede: string, hospital: string, chave: string): Promise<boolean>;
}

const CODIGO_EST = /^[a-z][a-z0-9]{1,9}$/;

function desligadoEm(nome: string): ErroProblema {
  return new ErroProblema(
    'recurso-desligado',
    403,
    'Funcionalidade desligada',
    `O acesso ao prontuário entre os estabelecimentos ainda não foi liberado em ${nome}: a regra de compartilhamento do prontuário (DP-42) precisa estar registrada nos dois estabelecimentos.`,
    { codigo: 'recurso-desligado' },
  );
}

export class AcessoProntuarioRede {
  constructor(private readonly d: DependenciasAcessoRede) {}

  /** O estabelecimento é desta rede (regra 12), diferente do da sessão e com o MPI e o acesso cruzado ligados nele. */
  private async conferirEstabelecimento(s: SessaoAcessoRede, est: string): Promise<string> {
    const nome = this.d.rede.estabelecimentos().find((e) => e.codigo === est)?.nome;
    if (!CODIGO_EST.test(est) || !nome || est === s.hospital || this.d.rede.redeConfigurada() !== s.rede)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora da rede',
        'O estabelecimento pedido não é outro estabelecimento da rede desta sessão.',
        { codigo: 'fora-da-rede' },
      );
    for (const chave of [CHAVE_LIBERACAO_MPI_REDE, CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE])
      if (!(await this.d.ligadaNoEstabelecimento(s.rede, est, chave))) throw desligadoEm(nome);
    return nome;
  }

  /**
   * D-TRILHA-REMOTA-57: cada estabelecimento tem o seu cadastro de usuários, e o mesmo login pode ser OUTRA pessoa no
   * outro banco. Só é a mesma pessoa com o mesmo CPF (11 dígitos) no cadastro de usuários dos dois bancos; login
   * inexistente, sem CPF ou leitura que falhe: não provado (falha fechada: a trilha de lá fica sem o nome).
   */
  private async mesmaPessoa(s: SessaoAcessoRede, est: string): Promise<boolean> {
    try {
      const [aqui, la] = await Promise.all([
        this.d.rede.cpfDoLogin({ rede: s.rede, hospital: s.hospital }, s.login),
        this.d.rede.cpfDoLogin({ rede: s.rede, hospital: est }, s.login),
      ]);
      return aqui !== null && /^\d{11}$/.test(aqui) && aqui === la;
    } catch {
      return false;
    }
  }

  /**
   * Abre a linha do tempo do paciente no outro estabelecimento. Quem chama já exigiu a permissão
   * `pep.prontuario.lerRede`, as chaves no estabelecimento da sessão e o acesso ao paciente aqui.
   */
  async abrir(
    s: SessaoAcessoRede,
    paciente: number,
    est: string,
    pedido: PedidoProntuarioRede,
    prof: ProfissionalPep | null,
  ): Promise<ProntuarioRede> {
    const nome = await this.conferirEstabelecimento(s, est);
    const vinculos = await this.d.rede.vinculosDoCadastro({ rede: s.rede, hospital: s.hospital }, paciente);
    const v = vinculos.find((x) => x.situacao === 'ativo' && x.estabelecimentoRemoto === est);
    if (!v)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Sem vínculo com o outro estabelecimento',
        `Este cadastro não está ligado a um cadastro de ${nome} no MPI da Rede.`,
        { codigo: 'sem-vinculo-rede' },
      );
    const remoto: ContextoDocs = { ...s.porta, ...contextoDoEstabelecimento(est), hospital: est };
    await this.d.documentos.exigirPaciente(remoto, v.idRemoto);
    // Regra 7: a trilha no banco onde o registro está, antes de qualquer dado (sem trilha, sem dado). Em nome do login
    // só quando ele é provadamente a mesma pessoa lá; senão, só a trilha própria de lá, como "(desconhecido)", com o
    // estabelecimento de origem e o login na chave natural.
    const confirmado = await this.mesmaPessoa(s, est);
    try {
      await this.d.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.prontuarioRedeLido.codigo,
        rede: s.rede,
        hospital: est,
        usuario: s.login,
        estacao: s.estacao.slice(0, 80),
        correlacao: s.correlacao.slice(0, 64),
        recurso: 'pep.prontuario',
        resultado: 'sucesso',
        paciente: v.idRemoto,
        tabelaAlvo: 'RICADPAC',
        idAlvo: String(v.idRemoto),
        chaveNaturalAlvo: `rede;de:${s.hospital};por:${s.login};motivo:${pedido.motivo};parte:linha-do-tempo`,
        ...(confirmado ? {} : { usuarioNaoConfirmado: true }),
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        `A leitura não foi registrada em ${nome}; nada foi mostrado. Tente de novo em instantes.`,
      );
    }
    const lt = await this.d.documentos.linhaTempo(remoto, v.idRemoto, { pagina: pedido.pagina }, prof);
    return {
      estabelecimento: est,
      estabelecimentoNome: nome,
      idRemoto: v.idRemoto,
      prontuarioRemoto: v.prontuarioRemoto,
      // Só a linha do tempo: o documento do outro estabelecimento não abre daqui (nem a categoria do profissional).
      eventos: lt.eventos.map((e) => ({
        chave: e.chave,
        tipo: e.tipo,
        quando: e.quando,
        titulo: e.titulo,
        detalhe: e.detalhe,
        profissional: e.profissional,
        situacao: e.situacao,
        suspenso: e.suspenso,
        sigilo: e.sigilo,
      })),
      pagina: lt.pagina,
      temMais: lt.temMais,
    };
  }
}
