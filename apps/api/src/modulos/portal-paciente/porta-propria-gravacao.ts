// Gravação PRÓPRIA do portal do paciente (modulos-proprios-1, família portal-b): os 22 métodos do GravadorPortal que a
// porta própria recusava com 503, sobre a transação da operação do Executor (`TxOperacao`), com a trilha, o outbox e a
// idempotência da operação. O contrato é o da porta de memória (porta-memoria.ts): as mesmas recusas de domínio
// (ErroPortal, ErroPedido, recusa do núcleo) e a mesma regra de versão (a conta e o vínculo relidos sob trava).
//   - Conta (convite, ativação, entrada, senha, segundo fator, bloqueio, encerramento): conta_portal_paciente.
//   - Troca do e-mail: troca_email_conta_portal (um pedido pendente por conta, o código só como resumo).
//   - Vínculo do responsável: vinculo_responsavel_portal (segregação: quem pede não decide).
//   - Consentimento pelo portal: consentimento_titular e o histórico (nada é apagado: a decisão nova revoga a anterior).
//   - Pedido do titular e cópia do prontuário: pedido_titular (+ histórico), solicitacao_copia_prontuario e
//     ato_copia_prontuario (o pedido travado; a regra do ato é a função pura `conferir` do serviço).
// Nenhuma mensagem sai daqui (regra 6): o envio do convite e do código é do serviço, neutralizado fora de produção.
// Melhoria: a conta encerrada libera o paciente para uma conta nova (unicidade só da conta vigente, no banco).
// Melhoria: o convite, o e-mail e o código da troca são únicos pelo resumo no banco (UNIQUE), não só no serviço.
// Melhoria: o contador de erros do convite e de entradas não muda a versão da conta (o formulário aberto continua
//   válido), como na porta de memória.
// Escopo: a conta, a troca do e-mail e o vínculo pertencem ao ESTABELECIMENTO da sessão, como na memória (o estado
//   guardado por ContextoPortal.hospital): toda leitura sob trava filtra estabelecimento_id, e a conta de outro
//   estabelecimento não é encontrada (a gravação não altera nem zera a credencial de conta alheia). Uma conta vigente
//   por paciente em cada estabelecimento (uq_conta_portal_paciente_vigente_estab). O e-mail (login) e os resumos do
//   convite e do código seguem únicos no cliente: melhoria (o login não é ambíguo na rede).
// Quem decide o vínculo (aprovação no balcão ou decisão) precisa ser usuário do hospital (recusa
//   'usuario-inexistente'); só o encerramento pelo portal guarda o login da conta sem usuário (CHECK da decisão).
import {
  ErroOperacao,
  garantirSequencia,
  type Linha,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import type { DominiosConsentimento, GravadorPortal } from './porta.js';
import { ErroPedido, ErroPortal, type RegistroTrilhaPortal, type SituacaoContaPortal } from './tipos.js';

/** Tabelas que estas gravações tocam (somar às TABELAS_PORTAL da operação `portal-paciente.gravar`). */
export const TABELAS_GRAVACAO_PORTAL = [
  'conta_portal_paciente',
  'troca_email_conta_portal',
  'vinculo_responsavel_portal',
  'consentimento_titular',
  'consentimento_titular_historico',
  'pedido_titular',
  'pedido_titular_historico',
  'solicitacao_copia_prontuario',
  'ato_copia_prontuario',
  'sequencia_negocio',
] as const;

/** Código do tipo de termo LGPD do consentimento pelo portal (catálogo tipo_termo_lgpd do cliente). */
export const TIPO_TERMO_PORTAL = 'portal_paciente';

/** Situação da conta no banco ↔ situação do domínio. */
export const SITUACAO_CONTA_DO_BANCO: Readonly<Record<string, SituacaoContaPortal>> = {
  pendente_ativacao: 'convidada',
  ativa: 'ativa',
  bloqueada: 'bloqueada',
  encerrada: 'encerrada',
};
const CONTA_DO_DOMINIO: Readonly<Record<SituacaoContaPortal, string>> = {
  convidada: 'pendente_ativacao',
  ativa: 'ativa',
  bloqueada: 'bloqueada',
  encerrada: 'encerrada',
};

/** Domínios do consentimento no banco próprio (os ids do contrato do portal ↔ os valores do modelo). */
export const DOMINIOS_CONSENTIMENTO_PROPRIO: DominiosConsentimento = {
  signatarios: [
    { id: 1, descricao: 'Paciente', ativo: true },
    { id: 2, descricao: 'Representante Legal', ativo: true },
  ],
  situacoes: [
    { id: 1, descricao: 'Lançado', ativo: true },
    { id: 3, descricao: 'Consentimento Autorizado', ativo: true },
    { id: 4, descricao: 'Não autorizado', ativo: true },
  ],
  revogacoes: [{ id: 2, descricao: 'Revogação', ativo: true }],
};
export const SIGNATARIO_DO_BANCO: Readonly<Record<number, string>> = {
  1: 'paciente',
  2: 'representante_legal',
};
export const SITUACAO_CONSENTIMENTO_DO_BANCO: Readonly<Record<number, string>> = {
  1: 'emitido',
  3: 'autorizado',
  4: 'recusado',
};

/** Tipo do pedido do titular: contrato do portal → modelo (ck_pedido_titular_tipo). */
const TIPO_PEDIDO: Readonly<Record<string, string>> = {
  compartilhamento: 'informacao_compartilhamento',
  'revogacao-consentimento': 'revogacao_consentimento',
  'revisao-decisao-automatizada': 'revisao_decisao_automatizada',
};
const tipoPedidoDoBanco = (t: string) => TIPO_PEDIDO[t] ?? t.replace(/-/g, '_');
/** Situação do pedido no banco → domínio (a mesma tabela da administração). */
export const SITUACAO_PEDIDO_DO_BANCO: Readonly<Record<string, string>> = {
  recebido: 'aberto',
  em_analise: 'identidade-verificada',
  aguardando_titular: 'identidade-verificada',
  atendido: 'atendido',
  atendido_parcial: 'atendido',
  indeferido: 'negado',
  cancelado: 'cancelado',
};
/** Envio do código da troca do e-mail: domínio → modelo. */
const ENVIO_DO_BANCO: Readonly<Record<string, string>> = { simulador: 'simulador', halai: 'plataforma' };

/** Onde a gravação escreveu de fato (a trilha da operação aponta para cá). */
export interface EscritaPortal {
  tabela: string;
  id: number | null;
}

/**
 * O executor traduz o erro que não é ErroOperacao num 500: a operação `portal-paciente.gravar` guarda o erro de
 * domínio do portal (ErroPortal, ErroPedido) lançado pela gravação e o relança ao serviço depois do ROLLBACK.
 */
export function erroDeDominio(e: unknown): Error | null {
  return e instanceof ErroPortal || e instanceof ErroPedido ? e : null;
}

const num = (v: unknown): number => Number(v);
const dia = (d: Date) => d.toISOString().slice(0, 10);
const corte = (s: string | null | undefined, n: number) => (s == null ? null : s.slice(0, n));

const versaoVelha = (o: string) =>
  new ErroPortal('versao-desatualizada', `A conta foi alterada por outra pessoa (${o}); recarregue.`);
const vinculoVelho = () =>
  new ErroPortal('versao-desatualizada', 'O pedido foi alterado por outra pessoa; recarregue.');

/**
 * As 22 gravações do portal sobre a transação da operação. `aoTrilhar` recebe o registro da trilha que o pedido do
 * titular e a cópia trazem prontos (a operação o leva aos dados da trilha).
 */
export function gravadorGravacaoPropria(
  tx: TxOperacao,
  estabelecimento: number,
  escrita: EscritaPortal,
  aoTrilhar: (r: RegistroTrilhaPortal) => void = () => undefined,
): Omit<GravadorPortal, 'registrarManifestacao'> {
  const marcar = (tabela: string, id: number) => {
    escrita.tabela = tabela;
    escrita.id = id;
  };

  const travarConta = async (id: number) => {
    const [l] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, convite_usado_em, ativada_em, tentativas_falhas
         FROM conta_portal_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, estabelecimento],
    );
    return l
      ? {
          conviteUsadoEm: l['convite_usado_em'] as unknown,
          ativadaEm: l['ativada_em'] as unknown,
          situacao: SITUACAO_CONTA_DO_BANCO[String(l['situacao'])]!,
          versao: num(l['versao']),
        }
      : null;
  };
  /** A conta travada na versão e numa das situações aceitas; senão, a versão está velha. */
  const contaPara = async (
    id: number,
    versao: number | null,
    aceitas: readonly SituacaoContaPortal[],
    o: string,
  ) => {
    const k = await travarConta(id);
    if (!k || (versao !== null && k.versao !== versao) || !aceitas.includes(k.situacao)) throw versaoVelha(o);
    return k;
  };
  const alterarConta = async (id: number, versao: number, valores: Record<string, unknown>) => {
    try {
      await tx.alterar('conta_portal_paciente', id, versao, valores);
    } catch (e) {
      throw traduzirUnica(e);
    }
    marcar('conta_portal_paciente', id);
  };
  const traduzirUnica = (e: unknown): unknown => {
    const r = restricaoUnicaViolada(e);
    if (r === 'uq_conta_portal_paciente_convite')
      return new ErroPortal('convite-repetido', 'Código de convite repetido.');
    if (r === 'uq_conta_portal_paciente_email_resumo' || r === 'uq_conta_portal_paciente_login')
      return new ErroPortal('email-em-uso', 'E-mail já usado em outra conta.');
    if (r === 'uq_troca_email_conta_portal_codigo')
      return new ErroPortal('convite-repetido', 'Token repetido.');
    if (r === 'uq_conta_portal_paciente_vigente_estab' || r === 'uq_conta_portal_paciente_vigente')
      return recusa('conta-existente', 'O paciente já tem conta vigente no portal deste estabelecimento.');
    if (r === 'uq_troca_email_conta_portal_pendente')
      return new ErroPortal(
        'versao-desatualizada',
        'Outro pedido de troca do e-mail foi feito ao mesmo tempo; recarregue.',
      );
    return e;
  };
  const conviteUnico = async (resumo: string, exceto: number) => {
    const l = await tx.uma('SELECT id FROM conta_portal_paciente WHERE convite_resumo = ? AND id <> ?', [
      resumo,
      exceto,
    ]);
    if (l) throw new ErroPortal('convite-repetido', 'Código de convite repetido.');
  };
  const emailLivre = async (resumo: string, exceto: number) => {
    const l = await tx.uma('SELECT id FROM conta_portal_paciente WHERE email_resumo = ? AND id <> ?', [
      resumo,
      exceto,
    ]);
    if (l) throw new ErroPortal('email-em-uso', 'E-mail já usado em outra conta.');
  };
  /** A conta precisa ser deste estabelecimento (a de outro não é encontrada). */
  const contaDoEstabelecimento = async (id: number) => {
    if (!(await travarConta(id))) throw new ErroPortal('nao-encontrado', 'Conta do portal não encontrada.');
  };
  /** O usuário do hospital pelo login (null quando quem age é a conta do portal ou não é usuário). */
  const usuarioDoLogin = async (login: string | null | undefined): Promise<number | null> => {
    if (!login) return null;
    const l = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
    return l ? num(l['id']) : null;
  };
  const exigirUsuario = async (login: string): Promise<number> => {
    const u = await usuarioDoLogin(login);
    if (u === null)
      throw recusa('usuario-inexistente', 'Quem registra o ato precisa ser usuário do hospital.');
    return u;
  };
  const pacienteDoCadastro = async (id: number) => {
    const l = await tx.uma(
      `SELECT pa.id, pf.nome, pf.cpf FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE pa.id = ? AND pa.excluido_em IS NULL`,
      [id],
    );
    if (!l) throw new ErroPedido('paciente-inexistente', 'Paciente não encontrado.');
    return l;
  };
  const historicoPedido = (
    id: number,
    antes: string | null,
    depois: string,
    descricao: string,
    usuario: number | null,
  ) =>
    tx.incluir('pedido_titular_historico', {
      pedido_titular_id: id,
      operacao: antes === null ? 'inclusao' : 'alteracao',
      ocorrido_em: new Date(),
      usuario_id: usuario,
      situacao_anterior: antes,
      situacao_nova: depois,
      descricao,
    });

  /** O pedido do titular (o escritor do M10 no modelo próprio), com o histórico; devolve id e protocolo. */
  const novoPedido = async (p: {
    idPaciente: number;
    tipo: string;
    canal: string;
    descricao: string | null;
    prazoDias: number;
    conta: number | null;
    identidadeVerificada: boolean;
  }) => {
    const pac = await pacienteDoCadastro(p.idPaciente);
    const agora = new Date();
    await garantirSequencia(
      tx,
      { tipo: 'pedido_titular', estabelecimento, prefixo: 'LGPD-' },
      { usuario: tx.contexto.usuario, agora },
    );
    const numero = await tx.proximoNumero('pedido_titular');
    const situacao = p.identidadeVerificada ? 'em_analise' : 'recebido';
    const id = await tx.incluir('pedido_titular', {
      estabelecimento_id: estabelecimento,
      numero: numero.formatado,
      paciente_id: num(pac['id']),
      titular_nome: String(pac['nome']).slice(0, 150),
      titular_cpf: pac['cpf'] == null ? null : String(pac['cpf']),
      tipo: tipoPedidoDoBanco(p.tipo),
      canal_recebimento: p.canal,
      descricao: p.descricao ?? 'Pedido registrado pelo portal do paciente sem descrição.',
      recebido_em: agora,
      prazo_em: dia(new Date(agora.getTime() + p.prazoDias * 86_400_000)),
      identidade_confirmada: p.identidadeVerificada,
      identidade_confirmada_em: p.identidadeVerificada ? agora : null,
      situacao,
      conta_portal_paciente_id: p.conta,
    });
    await historicoPedido(id, null, situacao, 'Pedido registrado', tx.contexto.usuario);
    return { id, protocolo: numero.formatado };
  };
  const trilhaDe = (
    t: Omit<RegistroTrilhaPortal, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>,
    tabela: string,
    id: number,
    chave: string,
  ) => aoTrilhar({ ...t, tabelaAlvo: tabela, idAlvo: String(id), chaveNaturalAlvo: chave });

  return {
    // ------------------------------------------------------------------ conta
    criarConta: async (x) => {
      await conviteUnico(x.conviteResumo, 0);
      let id: number;
      try {
        id = await tx.incluir('conta_portal_paciente', {
          estabelecimento_id: estabelecimento,
          tipo: x.tipo,
          paciente_id: x.paciente,
          nome_responsavel: corte(x.nome, 150),
          nascimento_responsavel: x.nascimento,
          situacao: 'pendente_ativacao',
          convite_resumo: x.conviteResumo,
          convite_valido_ate: x.conviteValidoAte,
          convite_erradas: 0,
          convite_origem: corte(x.origem, 20),
          convidado_por: corte(x.por, 60),
        });
      } catch (e) {
        throw traduzirUnica(e);
      }
      marcar('conta_portal_paciente', id);
      return { id };
    },
    reemitirConvite: async (id, versao, x) => {
      const k = await contaPara(id, versao, x.refazer ? ['ativa', 'bloqueada'] : ['convidada'], 'convite');
      await conviteUnico(x.conviteResumo, id);
      await alterarConta(id, k.versao, {
        situacao: CONTA_DO_DOMINIO.convidada,
        convite_resumo: x.conviteResumo,
        convite_valido_ate: x.conviteValidoAte,
        convite_usado_em: null,
        convite_erradas: 0,
        convite_origem: corte(x.origem, 20),
        convidado_por: corte(x.por, 60),
        tentativas_falhas: 0,
        bloqueada_ate: null,
        motivo_bloqueio: null,
        ...(x.refazer
          ? {
              senha_resumo: null,
              segundo_fator_envelope: null,
              segundo_fator_em: null,
              termo_aceito_em: null,
              email: null,
              email_resumo: null,
              login: null,
              email_verificado_em: null,
            }
          : {}),
      });
    },
    registrarErroConvite: async (id) => {
      const k = await travarConta(id);
      if (k?.situacao !== 'convidada') return;
      // O contador não muda a versão (o formulário aberto continua válido).
      await tx.executar(
        'UPDATE conta_portal_paciente SET convite_erradas = convite_erradas + 1 WHERE id = ?',
        [id],
      );
      marcar('conta_portal_paciente', id);
    },
    ativar: async (id, versao, a) => {
      const k = await contaPara(id, versao, ['convidada'], 'ativação');
      if (k.conviteUsadoEm) throw versaoVelha('ativação');
      await emailLivre(a.emailResumo, id);
      const t = new Date();
      await alterarConta(id, k.versao, {
        situacao: 'ativa',
        email: a.email,
        email_resumo: a.emailResumo,
        login: a.email,
        email_verificado_em: t,
        senha_resumo: a.senhaResumo,
        segundo_fator: 'aplicativo',
        segundo_fator_envelope: a.segundoFator,
        segundo_fator_em: t,
        termo_aceito_em: t,
        termo_uso_aceito: corte(a.termoUso, 40),
        politica_aceita: corte(a.politica, 40),
        convite_usado_em: t,
        ativada_em: k.ativadaEm ?? t,
        ultimo_acesso_em: t,
        tentativas_falhas: 0,
        bloqueada_ate: null,
      });
    },
    registrarEntrada: async (id, r) => {
      const k = await travarConta(id);
      if (k?.situacao !== 'ativa') return;
      // Como na memória: a entrada não muda a versão da conta.
      if (r.acertou)
        await tx.executar(
          'UPDATE conta_portal_paciente SET tentativas_falhas = 0, bloqueada_ate = NULL, ultimo_acesso_em = ? WHERE id = ?',
          [new Date(), id],
        );
      else
        await tx.executar(
          `UPDATE conta_portal_paciente SET tentativas_falhas = ?, bloqueada_ate = ?,
                  motivo_bloqueio = IF(? IS NULL, motivo_bloqueio, 'tentativas') WHERE id = ?`,
          [Math.min(r.tentativas, 999), r.bloqueadoAte, r.bloqueadoAte, id],
        );
      marcar('conta_portal_paciente', id);
    },
    trocarSenha: async (id, versao, senha) => {
      const k = await contaPara(id, versao, ['ativa'], 'senha');
      await alterarConta(id, k.versao, { senha_resumo: senha });
    },
    trocarSegundoFator: async (id, versao, envelope) => {
      const k = await contaPara(id, versao, ['ativa'], 'autenticador');
      await alterarConta(id, k.versao, { segundo_fator_envelope: envelope, segundo_fator_em: new Date() });
    },
    bloquear: async (id, versao, d) => {
      const k = await contaPara(id, versao, ['ativa', 'bloqueada'], 'bloqueio');
      await alterarConta(id, k.versao, {
        situacao: 'bloqueada',
        motivo_bloqueio: corte(d.motivo, 250),
        bloqueada_ate: null,
      });
    },
    desbloquear: async (id, versao) => {
      const k = await contaPara(id, versao, ['ativa', 'bloqueada'], 'desbloqueio');
      await alterarConta(id, k.versao, {
        situacao: 'ativa',
        motivo_bloqueio: null,
        bloqueada_ate: null,
        tentativas_falhas: 0,
      });
    },
    encerrar: async (id, versao, d) => {
      const k = await contaPara(id, versao, ['convidada', 'ativa', 'bloqueada'], 'encerramento');
      await alterarConta(id, k.versao, {
        situacao: 'encerrada',
        motivo_encerramento: corte(d.motivo, 250),
        encerrada_em: new Date(),
      });
    },

    // ------------------------------------------------------------------ troca do e-mail
    pedirTrocaEmail: async (t) => {
      await contaDoEstabelecimento(t.conta);
      const agora = new Date();
      const pendentes = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM troca_email_conta_portal
          WHERE conta_portal_paciente_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
        [t.conta],
      );
      for (const a of pendentes)
        await tx.alterar('troca_email_conta_portal', num(a['id']), num(a['versao']), {
          situacao: 'cancelada',
          decidido_em: agora,
        });
      const repetido = await tx.uma('SELECT id FROM troca_email_conta_portal WHERE codigo_resumo = ?', [
        t.tokenResumo,
      ]);
      if (repetido) throw new ErroPortal('convite-repetido', 'Token repetido.');
      let id: number;
      try {
        id = await tx.incluir('troca_email_conta_portal', {
          conta_portal_paciente_id: t.conta,
          email_novo: t.emailNovo,
          email_novo_resumo: t.emailNovoResumo,
          codigo_resumo: t.tokenResumo,
          valido_ate: t.validoAte,
          canal_pedido: t.origem,
          motivo: t.motivo.slice(0, 200),
          pedido_por_usuario_id: t.origem === 'balcao' ? await usuarioDoLogin(t.pedidoPor) : null,
          envio: ENVIO_DO_BANCO[t.envio] ?? t.envio,
          situacao: 'pendente',
        });
      } catch (e) {
        throw traduzirUnica(e);
      }
      marcar('troca_email_conta_portal', id);
      return { id };
    },
    confirmarTrocaEmail: async (troca, id, versao, x) => {
      const k = await contaPara(id, versao, ['ativa', 'bloqueada'], 'e-mail');
      await emailLivre(x.resumo, id);
      const [t] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM troca_email_conta_portal
          WHERE id = ? AND conta_portal_paciente_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
        [troca, id],
      );
      if (!t) throw new ErroPortal('situacao', 'O pedido de troca do e-mail não está mais pendente.');
      const agora = new Date();
      await alterarConta(id, k.versao, {
        email: x.email,
        email_resumo: x.resumo,
        login: x.email,
        email_verificado_em: agora,
      });
      await tx.alterar('troca_email_conta_portal', troca, num(t['versao']), {
        situacao: 'confirmada',
        decidido_em: agora,
      });
    },
    cancelarTrocaEmail: async (troca) => {
      const [t] = await tx.consultarParaAtualizar(
        `SELECT t.id, t.versao FROM troca_email_conta_portal t
           JOIN conta_portal_paciente c ON c.id = t.conta_portal_paciente_id
          WHERE t.id = ? AND c.estabelecimento_id = ? AND t.situacao = 'pendente' AND t.excluido_em IS NULL`,
        [troca, estabelecimento],
      );
      if (!t) throw new ErroPortal('situacao', 'O pedido de troca do e-mail não está mais pendente.');
      await tx.alterar('troca_email_conta_portal', troca, num(t['versao']), {
        situacao: 'cancelada',
        decidido_em: new Date(),
      });
      marcar('troca_email_conta_portal', troca);
    },

    // ------------------------------------------------------------------ vínculo do responsável
    pedirVinculo: async (v) => {
      if (v.decididoPor !== null && v.decididoPor === v.por)
        throw recusa('segregacao-decisao', 'Quem pede o vínculo não pode aprová-lo.');
      await contaDoEstabelecimento(v.conta);
      const agora = new Date();
      const ativo = v.decididoPor !== null;
      const decisor = v.decididoPor !== null ? await exigirUsuario(v.decididoPor) : null;
      const id = await tx.incluir('vinculo_responsavel_portal', {
        estabelecimento_id: estabelecimento,
        conta_portal_paciente_id: v.conta,
        paciente_id: v.titular,
        situacao: ativo ? 'ativo' : 'pendente',
        tipo_vinculo: v.tipo,
        prova: v.prova.slice(0, 40),
        prova_arquivo_chave: corte(v.arquivoChave, 300),
        prova_resumo: v.arquivoHash,
        validade: v.validade,
        escopos: JSON.stringify([...v.escopos]),
        canal: v.canal,
        pedido_em: agora,
        pedido_por: v.por.slice(0, 60),
        decidido_por: corte(v.decididoPor, 60),
        decidido_por_usuario_id: decisor,
        decidido_em: ativo ? agora : null,
      });
      marcar('vinculo_responsavel_portal', id);
      return { id };
    },
    decidirVinculo: async (id, versao, d) => {
      const [v] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, pedido_por FROM vinculo_responsavel_portal
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, estabelecimento],
      );
      if (!v || num(v['versao']) !== versao || v['situacao'] !== 'pendente') throw vinculoVelho();
      if (d.por === String(v['pedido_por']))
        throw recusa('segregacao-decisao', 'Quem pede o vínculo não pode decidi-lo.');
      const base = {
        decidido_por: d.por.slice(0, 60),
        decidido_por_usuario_id: await exigirUsuario(d.por),
        decidido_em: new Date(),
      };
      await tx.alterar(
        'vinculo_responsavel_portal',
        id,
        versao,
        d.aprovar
          ? { ...base, situacao: 'ativo', escopos: JSON.stringify([...d.escopos]), validade: d.validade }
          : { ...base, situacao: 'recusado', motivo_recusa: d.motivo.slice(0, 200) },
      );
      marcar('vinculo_responsavel_portal', id);
    },
    encerrarVinculo: async (id, versao, d) => {
      const [v] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, decidido_por, decidido_por_usuario_id, decidido_em
           FROM vinculo_responsavel_portal WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, estabelecimento],
      );
      if (
        !v ||
        !['pendente', 'ativo'].includes(String(v['situacao'])) ||
        (versao !== null && num(v['versao']) !== versao)
      )
        throw vinculoVelho();
      // Como na memória: o pedido nunca decidido recebe a decisão no mesmo instante do fim.
      const t = new Date();
      await tx.alterar('vinculo_responsavel_portal', id, num(v['versao']), {
        situacao: 'encerrado',
        motivo_fim: d.motivo.slice(0, 40),
        encerrado_em: t,
        decidido_por: v['decidido_por'] ?? d.por.slice(0, 60),
        decidido_por_usuario_id: v['decidido_por_usuario_id'] ?? (await usuarioDoLogin(d.por)),
        decidido_em: v['decidido_em'] ?? t,
      });
      marcar('vinculo_responsavel_portal', id);
    },

    // ------------------------------------------------------------------ consentimento
    registrarConsentimento: async (x) => {
      const situacao = DOMINIOS_CONSENTIMENTO_PROPRIO.situacoes.some((d) => d.id === x.situacao && d.ativo)
        ? SITUACAO_CONSENTIMENTO_DO_BANCO[x.situacao]
        : undefined;
      if (!situacao)
        throw recusa('situacao-invalida', 'Situação do termo desconhecida.', { campos: ['situacao'] });
      const signatario = DOMINIOS_CONSENTIMENTO_PROPRIO.signatarios.some(
        (d) => d.id === x.signatario && d.ativo,
      )
        ? SIGNATARIO_DO_BANCO[x.signatario]
        : undefined;
      if (!signatario)
        throw recusa('signatario-invalido', 'Signatário desconhecido.', { campos: ['signatario'] });
      if (signatario === 'representante_legal' && x.vinculo === null)
        throw recusa('signatario-invalido', 'O representante assina pelo vínculo do portal.', {
          campos: ['signatario'],
        });
      const termo = await tx.uma(
        "SELECT id FROM tipo_termo_lgpd WHERE codigo = ? AND ativo AND finalidade = 'consentimento'",
        [TIPO_TERMO_PORTAL],
      );
      if (!termo)
        throw new ErroOperacao(
          503,
          'catalogo-incompleto',
          'Catálogo incompleto',
          'O tipo de termo do consentimento pelo portal não está cadastrado. Procure o hospital.',
        );
      await pacienteDoCadastro(x.idPaciente);
      const agora = new Date();
      await garantirSequencia(
        tx,
        { tipo: 'consentimento_titular', estabelecimento, prefixo: 'TC-' },
        { usuario: tx.contexto.usuario, agora },
      );
      const numero = await tx.proximoNumero('consentimento_titular');
      const id = await tx.incluir('consentimento_titular', {
        estabelecimento_id: estabelecimento,
        numero: numero.formatado,
        tipo_termo_lgpd_id: num(termo['id']),
        paciente_id: x.idPaciente,
        finalidade: x.finalidade.slice(0, 500),
        versao_termo: x.versao.slice(0, 40),
        tipo_signatario: signatario,
        situacao,
        emitido_em: agora,
        autorizado_em: situacao === 'autorizado' ? agora : null,
        canal_registro: 'portal',
        conta_portal_paciente_id: x.conta,
        vinculo_responsavel_portal_id: x.vinculo,
      });
      await tx.incluir('consentimento_titular_historico', {
        consentimento_titular_id: id,
        operacao: 'inclusao',
        situacao_nova: situacao,
        dados: JSON.stringify({ canal: 'portal', versao: x.versao }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
      });
      marcar('consentimento_titular', id);
      return { id };
    },
    revogarConsentimento: async (r) => {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM consentimento_titular
          WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND revogado_em IS NULL AND excluido_em IS NULL`,
        [r.id, r.idPaciente, estabelecimento],
      );
      if (!k) throw recusa('consentimento-revogado', 'O consentimento não existe ou já foi revogado.');
      const motivo = DOMINIOS_CONSENTIMENTO_PROPRIO.revogacoes.find((d) => d.id === r.motivo);
      if (!motivo) throw recusa('motivo-invalido', 'Tipo de revogação desconhecido.', { campos: ['motivo'] });
      const agora = new Date();
      await tx.alterar('consentimento_titular', r.id, num(k['versao']), {
        situacao: 'revogado',
        revogado_em: agora,
        motivo_revogacao: motivo.descricao,
      });
      await tx.incluir('consentimento_titular_historico', {
        consentimento_titular_id: r.id,
        operacao: 'alteracao',
        situacao_anterior: String(k['situacao']),
        situacao_nova: 'revogado',
        dados: JSON.stringify({ canal: 'portal', motivo: r.motivo }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
      });
      marcar('consentimento_titular', r.id);
    },

    // ------------------------------------------------------------------ pedido do titular
    registrarPedido: async (p, trilha) => {
      const r = await novoPedido({ ...p, canal: 'portal' });
      marcar('pedido_titular', r.id);
      trilhaDe(trilha, 'pedido_titular', r.id, r.protocolo);
      return { id: String(r.id), protocolo: r.protocolo };
    },
    cancelarPedido: async (p, trilha) => {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM pedido_titular
          WHERE numero = ? AND estabelecimento_id = ? AND paciente_id = ? AND conta_portal_paciente_id = ?
            AND excluido_em IS NULL`,
        [p.protocolo, estabelecimento, p.idPaciente, p.conta],
      );
      if (!k) throw new ErroPedido('pedido-inexistente', 'Pedido não encontrado.');
      const antes = String(k['situacao']);
      const r = p.conferir(SITUACAO_PEDIDO_DO_BANCO[antes] ?? antes);
      if (r) throw new ErroPedido('transicao', r);
      const id = num(k['id']);
      await tx.alterar('pedido_titular', id, num(k['versao']), {
        situacao: 'cancelado',
        motivo_cancelamento: p.motivo.slice(0, 40),
        observacao_cancelamento: corte(p.observacao, 500),
        cancelado_em: new Date(),
      });
      await historicoPedido(id, antes, 'cancelado', 'Pedido cancelado pelo titular', tx.contexto.usuario);
      marcar('pedido_titular', id);
      trilhaDe(trilha, 'pedido_titular', id, p.protocolo);
    },

    // ------------------------------------------------------------------ cópia do prontuário
    pedirCopia: async (p, trilhas) => {
      const balcao = p.canal === 'balcao';
      const usuario = balcao ? await exigirUsuario(p.por) : null;
      if (!balcao && p.conta === null)
        throw recusa('conta-inexistente', 'A cópia pelo portal precisa da conta.');
      const pedido = await novoPedido({
        idPaciente: p.idPaciente,
        tipo: 'acesso',
        canal: balcao ? 'presencial' : 'portal',
        descricao: p.descricao,
        prazoDias: p.prazoDias,
        conta: p.conta,
        identidadeVerificada: p.identidadeVerificada,
      });
      const pac = await pacienteDoCadastro(p.idPaciente);
      const agora = new Date();
      await garantirSequencia(
        tx,
        { tipo: 'solicitacao_copia_prontuario', estabelecimento, prefixo: '' },
        { usuario: tx.contexto.usuario, agora },
      );
      const numero = await tx.proximoNumero('solicitacao_copia_prontuario');
      const titular = p.solicitante === 'titular';
      const solicitacao = await tx.incluir('solicitacao_copia_prontuario', {
        estabelecimento_id: estabelecimento,
        numero: numero.valor,
        paciente_id: p.idPaciente,
        solicitante_tipo: titular ? 'paciente' : 'representante_legal',
        solicitante_nome: titular ? String(pac['nome']).slice(0, 150) : 'Representante do titular',
        solicitante_parentesco: corte(p.vinculo, 60),
        motivo: 'Cópia do prontuário pedida pelo titular (acesso aos dados)',
        detalhamento: p.descricao,
        solicitada_em: agora,
        prazo_entrega: dia(new Date(agora.getTime() + p.prazoDias * 86_400_000)),
        formato_entrega: balcao ? 'impresso' : 'digital',
        situacao: p.identidadeVerificada ? 'em_analise' : 'solicitada',
        pedido_titular_id: pedido.id,
      });
      const ato = await tx.incluir('ato_copia_prontuario', {
        estabelecimento_id: estabelecimento,
        solicitacao_copia_prontuario_id: solicitacao,
        ato: 'solicitacao',
        solicitante: corte(p.solicitante, 30),
        vinculo: corte(p.vinculo, 30),
        prova: corte(p.prova, 40),
        usuario_id: usuario,
        conta_portal_paciente_id: p.conta,
        ocorrido_em: agora,
      });
      marcar('pedido_titular', pedido.id);
      trilhaDe(trilhas.pedido, 'pedido_titular', pedido.id, pedido.protocolo);
      trilhaDe(trilhas.copia, 'ato_copia_prontuario', ato, pedido.protocolo);
      return { id: String(pedido.id), protocolo: pedido.protocolo };
    },
    registrarAtoCopia: async (d, trilha) => {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, tipo, paciente_id FROM pedido_titular
          WHERE numero = ? AND estabelecimento_id = ? AND excluido_em IS NULL
            ${d.idPaciente === null ? '' : 'AND paciente_id = ?'}`,
        d.idPaciente === null ? [d.protocolo, estabelecimento] : [d.protocolo, estabelecimento, d.idPaciente],
      );
      if (!k) throw new ErroPedido('pedido-inexistente', 'Pedido não encontrado.');
      if (k['tipo'] !== 'acesso')
        throw new ErroPedido('transicao', 'A cópia do prontuário é um pedido de acesso aos dados.');
      const [s] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM solicitacao_copia_prontuario
          WHERE pedido_titular_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [num(k['id']), estabelecimento],
      );
      if (!s) throw new ErroPedido('transicao', 'O pedido não tem a cópia do prontuário aberta.');
      const atos = (await tx.consultar(
        'SELECT ato FROM ato_copia_prontuario WHERE solicitacao_copia_prontuario_id = ? ORDER BY id',
        [num(s['id'])],
      )) as Linha[];
      const antes = String(k['situacao']);
      const r = d.conferir(
        SITUACAO_PEDIDO_DO_BANCO[antes] ?? antes,
        atos.map((a) => ({ ato: String(a['ato']) })),
      );
      if (r) throw new ErroPedido('transicao', r);
      const usuario = await exigirUsuario(d.por);
      const agora = new Date();
      const id = await tx.incluir('ato_copia_prontuario', {
        estabelecimento_id: estabelecimento,
        solicitacao_copia_prontuario_id: num(s['id']),
        ato: d.ato,
        solicitante: corte(d.solicitante, 30),
        vinculo: corte(d.vinculo, 30),
        prova: corte(d.prova, 40),
        hash_conteudo: d.hash ?? null,
        paginas: d.paginas ?? null,
        meio: corte(d.meio, 20),
        recebedor: corte(d.recebedor, 150),
        usuario_id: usuario,
        ocorrido_em: agora,
      });
      const idPedido = num(k['id']);
      let depois = antes;
      const solicitacao: Record<string, unknown> = {};
      if (d.ato === 'legitimidade') {
        solicitacao['legitimidade_em'] = agora;
        if (s['situacao'] === 'solicitada') solicitacao['situacao'] = 'em_analise';
        if (antes === 'recebido') {
          depois = 'em_analise';
          await tx.alterar('pedido_titular', idPedido, num(k['versao']), {
            situacao: depois,
            identidade_confirmada: true,
            identidade_confirmada_em: agora,
          });
        }
      } else if (d.ato === 'geracao') {
        solicitacao['situacao'] = 'pronta';
      } else {
        solicitacao['situacao'] = 'entregue';
        solicitacao['entregue_em'] = agora;
        depois = 'atendido';
        await tx.alterar('pedido_titular', idPedido, num(k['versao']), {
          situacao: depois,
          respondido_em: agora,
        });
      }
      await tx.alterar('solicitacao_copia_prontuario', num(s['id']), num(s['versao']), solicitacao);
      if (depois !== antes)
        await historicoPedido(idPedido, antes, depois, `Cópia do prontuário: ${d.ato}`, usuario);
      marcar('ato_copia_prontuario', id);
      trilhaDe(trilha, 'ato_copia_prontuario', id, d.protocolo);
      return {
        id: String(id),
        idPedido: String(idPedido),
        protocolo: d.protocolo,
        situacao: SITUACAO_PEDIDO_DO_BANCO[depois] ?? depois,
      };
    },
  };
}
