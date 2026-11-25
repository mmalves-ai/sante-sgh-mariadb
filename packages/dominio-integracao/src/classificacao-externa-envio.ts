// Classificação de risco externa (F3.9, linha 08-INTG L140), a troca ativa com o sistema de triagem:
//   - a SAÍDA dos perfis de prioridade (gestante, idoso, mobilidade reduzida...) como notificação de arquivo mestre do
//     HL7 v2 (MFN^M13, "arquivo mestre geral": MFI com a substituição do arquivo inteiro e um MFE por perfil, na ordem de
//     prioridade), montada pelo perfil de mensagem HL7 cadastrado para o sistema de triagem (versão e separadores);
//   - a ENTRADA da classificação pela credencial do próprio sistema de triagem (cliente da API ligado ao sistema
//     externo de categoria triagem, com usuário técnico para a trilha): quem envia é a credencial, nunca o corpo.
// Tudo puro: a porta lê e grava, o domínio decide e monta.
import { dataHl7, escapar } from './hl7/mensagem.js';
import type { ErroClassificacao } from './classificacao-externa.js';

/** O tipo do evento na fila de saída (o enviador HL7 do worker reconhece por ele). */
export const EVENTO_ENVIO_PERFIS_TRIAGEM = 'classificacao.perfis';
/** O evento HL7 da mensagem de perfis (arquivo mestre geral). */
export const EVENTO_HL7_PERFIS_TRIAGEM = 'MFN^M13';
/** O escopo que a credencial do sistema de triagem precisa ter para enviar a classificação. */
export const ESCOPO_ENTRADA_TRIAGEM = 'classificacao.enviar';

const erro = (campo: string, codigo: string, mensagem: string): ErroClassificacao => ({
  campo,
  codigo,
  mensagem,
});

export interface PerfilEnviado {
  readonly codigo: string;
  readonly descricao: string;
  readonly condicao: string | null;
  readonly ordem: number;
}

export interface PerfilMensagemTriagem {
  readonly versaoHl7: string;
  readonly separadorCampo: string;
  readonly caracteresCodificacao: string;
  readonly ativo: boolean;
}

export interface SituacaoEnvioPerfis {
  /** O sistema externo é de categoria triagem e está ativo. */
  readonly sistemaTriagemAtivo: boolean;
  /** O parceiro HL7 do sistema (quem o worker entrega), com o canal do motor de integração. */
  readonly parceiroHl7ComCanal: boolean;
  readonly perfilMensagem: PerfilMensagemTriagem | null;
  readonly perfis: readonly PerfilEnviado[];
}

/** O que impede o envio ativo dos perfis (vazio: pode ir à fila de saída). */
export function conferirEnvioPerfis(s: SituacaoEnvioPerfis): ErroClassificacao[] {
  const e: ErroClassificacao[] = [];
  if (!s.sistemaTriagemAtivo)
    e.push(erro('sistema', 'sistema-nao-triagem', 'O sistema externo não é um sistema de triagem ativo.'));
  if (!s.parceiroHl7ComCanal)
    e.push(
      erro(
        'parceiro',
        'sem-parceiro-hl7',
        'O sistema de triagem não tem parceiro HL7 ativo com o canal do motor de integração.',
      ),
    );
  if (!s.perfilMensagem || !s.perfilMensagem.ativo)
    e.push(
      erro(
        'perfilMensagem',
        'sem-perfil-mensagem',
        `Cadastre o perfil de mensagem HL7 ${EVENTO_HL7_PERFIS_TRIAGEM} do sistema de triagem.`,
      ),
    );
  else if (s.perfilMensagem.separadorCampo !== '|' || s.perfilMensagem.caracteresCodificacao !== '^~\\&')
    e.push(
      erro(
        'perfilMensagem',
        'separadores-nao-suportados',
        'O perfil de mensagem usa separadores fora do padrão HL7 (| e ^~\\&).',
      ),
    );
  if (s.perfis.length === 0)
    e.push(erro('perfis', 'sem-perfis', 'Nenhum perfil de prioridade ativo para o sistema de triagem.'));
  return e;
}

export interface CabecalhoPerfis {
  readonly aplicacaoOrigem: string;
  readonly instituicaoOrigem: string;
  readonly aplicacaoDestino: string;
  readonly dataHora: Date;
  /** MSH-10 (até 20 caracteres): o sistema de triagem deduplica por ele. */
  readonly controle: string;
  readonly processamento: 'P' | 'T';
}

/**
 * A mensagem MFN^M13 dos perfis: MSH na versão do perfil de mensagem; MFI com o arquivo "perfis de prioridade" e a
 * substituição inteira (REP: o que não vier deixa de valer no sistema de triagem) pedindo confirmação (AL); um MFE por
 * perfil (MAD), na ordem de prioridade, com o código que o sistema de triagem conhece, a descrição e a condição.
 */
export function montarPerfisHl7(
  cab: CabecalhoPerfis,
  perfil: PerfilMensagemTriagem,
  perfis: readonly PerfilEnviado[],
): string {
  if (!/^[A-Za-z0-9._:-]{1,20}$/.test(cab.controle)) throw new Error('MSH-10 fora do formato.');
  const quando = dataHl7(cab.dataHora);
  const c = (...x: (string | null)[]) =>
    x
      .map((v) => (v === null ? '' : escapar(v)))
      .join('^')
      .replace(/\^+$/, '');
  const tipoChave = ['2.3', '2.3.1', '2.4'].includes(perfil.versaoHl7) ? 'CE' : 'CWE';
  const seg = (nome: string, campos: string[]) => [nome, ...campos].join('|').replace(/\|+$/, '');
  return [
    seg('MSH', [
      '^~\\&',
      c(cab.aplicacaoOrigem),
      c(cab.instituicaoOrigem),
      c(cab.aplicacaoDestino),
      c(cab.aplicacaoDestino),
      quando,
      '',
      'MFN^M13^MFN_M13',
      cab.controle,
      cab.processamento,
      perfil.versaoHl7,
    ]),
    seg('MFI', [c('PRIORIDADE', 'Perfis de prioridade', 'L'), '', 'REP', quando, quando, 'AL']),
    ...perfis
      .slice()
      .sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))
      .map((p, i) =>
        seg('MFE', [
          'MAD',
          String(i + 1),
          quando,
          c(p.codigo, p.descricao, 'L', p.condicao, null, p.condicao ? 'L' : null),
          tipoChave,
        ]),
      ),
  ].join('\r');
}

export interface CredencialTriagem {
  /** Categoria do sistema externo ligado ao cliente da API (null: o cliente não tem sistema). */
  readonly categoriaSistema: string | null;
  readonly sistemaAtivo: boolean;
  readonly situacaoCliente: string;
  /** O estabelecimento a que o cliente está restrito (null: vale para todos). */
  readonly restritoA: number | null;
  readonly estabelecimento: number;
  readonly usuarioTecnico: number | null;
  readonly escopos: readonly string[];
}

/**
 * A credencial do sistema de triagem vale para a entrada da classificação? (vazio: vale). Falha fechada: sem sistema
 * de triagem, suspensa, restrita a outro estabelecimento, sem usuário técnico (a trilha precisa de autor) ou sem o
 * escopo, a entrada é recusada.
 */
export function conferirCredencialTriagem(c: CredencialTriagem): ErroClassificacao[] {
  const e: ErroClassificacao[] = [];
  if (c.categoriaSistema !== 'triagem' || !c.sistemaAtivo)
    e.push(erro('credencial', 'nao-e-triagem', 'A credencial não é de um sistema de triagem ativo.'));
  if (c.situacaoCliente !== 'ativo')
    e.push(erro('credencial', 'credencial-inativa', 'A credencial do sistema de triagem não está ativa.'));
  if (c.restritoA !== null && c.restritoA !== c.estabelecimento)
    e.push(erro('credencial', 'outro-estabelecimento', 'A credencial não vale neste estabelecimento.'));
  if (c.usuarioTecnico === null)
    e.push(
      erro(
        'credencial',
        'sem-usuario-tecnico',
        'A credencial não tem o usuário técnico que assina a trilha.',
      ),
    );
  if (!c.escopos.includes(ESCOPO_ENTRADA_TRIAGEM))
    e.push(erro('credencial', 'fora-do-escopo', `A credencial não tem o escopo ${ESCOPO_ENTRADA_TRIAGEM}.`));
  return e;
}

/** A mensagem de perfis do mesmo pacote no mesmo dia que já está na fila de saída (a mais antiga primeiro). */
export interface EnvioPerfisAnterior {
  readonly chave: string;
  readonly situacao: string;
}

export type DecisaoEnvioPerfis =
  /** Nada vivo na fila para este pacote hoje: entra uma mensagem nova com esta chave e este MSH-10. */
  | { readonly acao: 'nova'; readonly chave: string; readonly sufixoControle: string }
  /** A mensagem do pacote está na fila, a caminho ou entregue: nada novo entra (devolve a existente). */
  | { readonly acao: 'repetida'; readonly chave: string }
  /** A mensagem do pacote morreu e segura a ordem do sistema de triagem: reprocessar pela fila de mortos. */
  | { readonly acao: 'recusar'; readonly erro: ErroClassificacao };

const VIVAS = new Set(['pendente', 'enviando', 'enviada', 'confirmada']);
const MORTAS = new Set(['erro', 'rejeitada', 'expirada']);

/**
 * O que fazer com o pedido de envio do pacote, pela situação da última mensagem gravada com a chave do pacote do dia
 * (a chave base ou a base com ":r<n>" das reenviadas). Viva (pendente, enviando, enviada, confirmada): repetida, sem
 * dizer que chegou o que ainda não chegou (a tela mostra a situação). Morta (erro, rejeitada, expirada): recusada,
 * porque a morta segura a ordem das mensagens do sistema de triagem até ser tratada; uma nova ficaria parada atrás dela.
 * Cancelada (a morta descartada no tratamento): entra uma nova com a chave e o MSH-10 seguintes (o sistema de triagem
 * deduplica pelo MSH-10). Situação desconhecida: falha fechada (recusa).
 */
export function decidirEnvioPerfis(
  chaveBase: string,
  anteriores: readonly EnvioPerfisAnterior[],
): DecisaoEnvioPerfis {
  const doPacote = anteriores.filter(
    (a) => a.chave === chaveBase || /^:r\d{1,2}$/.test(a.chave.slice(chaveBase.length)),
  );
  const ultima = doPacote.at(-1);
  if (!ultima) return { acao: 'nova', chave: chaveBase, sufixoControle: '' };
  if (VIVAS.has(ultima.situacao)) return { acao: 'repetida', chave: ultima.chave };
  if (ultima.situacao === 'cancelada') {
    const n = doPacote.length;
    if (n > 99)
      return {
        acao: 'recusar',
        erro: erro('envio', 'reenvios-esgotados', 'O pacote de perfis já foi reenviado demais hoje.'),
      };
    return { acao: 'nova', chave: `${chaveBase}:r${n}`, sufixoControle: `R${n}` };
  }
  return {
    acao: 'recusar',
    erro: erro(
      'envio',
      'envio-anterior-falhou',
      MORTAS.has(ultima.situacao)
        ? `O envio de hoje deste pacote de perfis falhou (situação ${ultima.situacao}) e não chegou ao sistema de triagem: reprocesse-o na fila de mortos das integrações.`
        : `O envio de hoje deste pacote de perfis está numa situação desconhecida (${ultima.situacao.slice(0, 30)}): confira a fila de saída das integrações.`,
    ),
  };
}
