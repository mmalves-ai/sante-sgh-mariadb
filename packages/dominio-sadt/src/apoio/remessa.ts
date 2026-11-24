// Laboratório de apoio (F3.5, 05-SADT linha 14): a remessa de envio com os itens, a etiqueta do apoio e o de-para de
// analito e de material. Regra pura, sem banco: a aplicação lê o estado e grava o que estas funções decidem.
// Desenho próprio: a remessa nasce já com as amostras pendentes do laboratório (um clique), fecha, sai com o protocolo
// e o meio de envio; cancelar exige motivo e nunca apaga (a remessa enviada não se cancela: o item é recusado pelo
// apoio). Cada item leva o código do exame e do material no apoio; o item sem de-para segura o fechamento.

export class RecusaApoio extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type SituacaoRemessa = 'aberta' | 'fechada' | 'enviada' | 'recebida' | 'concluida' | 'cancelada';
export type AcaoRemessa = 'incluir' | 'fechar' | 'reabrir' | 'enviar' | 'cancelar';
export type MeioEnvio = 'integracao' | 'portal' | 'manual';
export type CanalApoio = 'manual' | 'arquivo' | 'servico_web' | 'mensagem_padrao';

/** A situação depois da ação, ou a recusa (a transição fora da regra nunca grava). */
export function situacaoDaRemessaDepois(
  atual: SituacaoRemessa,
  acao: AcaoRemessa,
  dados: { readonly itens: number; readonly semDePara?: number; readonly motivo?: string | null } = {
    itens: 0,
  },
): SituacaoRemessa {
  switch (acao) {
    case 'incluir':
      if (atual !== 'aberta')
        throw new RecusaApoio('remessa-nao-aberta', 'Só a remessa aberta recebe amostras.');
      return 'aberta';
    case 'fechar':
      if (atual !== 'aberta') throw new RecusaApoio('remessa-nao-aberta', 'Só a remessa aberta se fecha.');
      if (dados.itens <= 0) throw new RecusaApoio('remessa-vazia', 'A remessa não tem amostras.');
      if ((dados.semDePara ?? 0) > 0)
        throw new RecusaApoio(
          'remessa-sem-de-para',
          `${dados.semDePara} exame(s) sem código no laboratório de apoio: complete o de-para antes de fechar.`,
        );
      return 'fechada';
    case 'reabrir':
      if (atual !== 'fechada')
        throw new RecusaApoio('remessa-nao-fechada', 'Só a remessa fechada se reabre.');
      return 'aberta';
    case 'enviar':
      if (atual !== 'fechada')
        throw new RecusaApoio('remessa-nao-fechada', 'Feche a remessa antes de enviá-la.');
      return 'enviada';
    case 'cancelar':
      if (atual !== 'aberta' && atual !== 'fechada')
        throw new RecusaApoio(
          'remessa-ja-enviada',
          'A remessa já saiu: o apoio recusa ou devolve cada amostra, a remessa não se cancela.',
        );
      if (!dados.motivo || dados.motivo.trim().length < 5)
        throw new RecusaApoio(
          'motivo-obrigatorio',
          'Informe o motivo do cancelamento (mínimo 5 caracteres).',
        );
      return 'cancelada';
  }
}

/** O meio de envio coerente com o canal do laboratório: a integração só para o apoio integrado. */
export function conferirMeioEnvio(canal: CanalApoio, meio: MeioEnvio): void {
  if (meio === 'integracao' && canal === 'manual')
    throw new RecusaApoio(
      'meio-incompativel',
      'Este laboratório de apoio não tem integração: envie pelo portal ou manualmente.',
    );
}

export interface AmostraCandidata {
  /** O exame foi encaminhado a este laboratório de apoio. */
  readonly doLaboratorio: boolean;
  readonly amostraColetada: boolean;
  /** O exame_item já está em outra remessa ativa (não cancelada). */
  readonly emOutraRemessa: boolean;
  readonly situacaoExame: string;
}

/** Só a amostra coletada de exame encaminhado ao apoio, fora de outra remessa e não cancelado, entra na remessa. */
export function conferirAmostraParaRemessa(a: AmostraCandidata): void {
  if (!a.doLaboratorio)
    throw new RecusaApoio(
      'exame-de-outro-apoio',
      'O exame não está encaminhado a este laboratório de apoio.',
    );
  if (['cancelado', 'suspenso'].includes(a.situacaoExame))
    throw new RecusaApoio('exame-cancelado', 'O exame foi cancelado ou suspenso.');
  if (!a.amostraColetada) throw new RecusaApoio('amostra-nao-coletada', 'A amostra ainda não foi coletada.');
  if (a.emOutraRemessa) throw new RecusaApoio('amostra-em-remessa', 'A amostra já está em outra remessa.');
}

export interface DadosEtiquetaApoio {
  readonly laboratorio: string;
  readonly codigoCliente: string | null;
  readonly remessa: string;
  readonly sequencia: number;
  readonly codigoBarras: string;
  readonly codigoExameApoio: string | null;
  readonly codigoMaterialApoio: string | null;
}

export interface EtiquetaApoio {
  /** O código que o apoio lê: cliente, remessa e sequência (ou o código de barras da amostra, sem cliente). */
  readonly codigo: string;
  readonly linhas: readonly string[];
}

/** A etiqueta do apoio: só identificadores (nenhum dado do paciente); o código lido é determinístico. */
export function etiquetaDoApoio(d: DadosEtiquetaApoio): EtiquetaApoio {
  if (!d.codigoExameApoio)
    throw new RecusaApoio('sem-de-para', 'O exame não tem código no laboratório de apoio.');
  const seq = String(d.sequencia).padStart(3, '0');
  const codigo = d.codigoCliente
    ? `${d.codigoCliente}-${d.remessa}-${seq}`.slice(0, 30)
    : d.codigoBarras.slice(0, 30);
  return {
    codigo,
    linhas: [
      d.laboratorio.slice(0, 40),
      `Remessa ${d.remessa} / ${seq}`,
      `Amostra ${d.codigoBarras}`,
      `Exame ${d.codigoExameApoio}${d.codigoMaterialApoio ? ` / Material ${d.codigoMaterialApoio}` : ''}`,
    ],
  };
}

const CODIGO_APOIO = /^[A-Za-z0-9._-]{1,30}$/;

/** O código no apoio: letras, números, ponto, hífen e sublinhado (o que o apoio aceita no leiaute). */
export function conferirCodigoApoio(codigo: string, campo = 'código'): string {
  const c = codigo.trim();
  if (!CODIGO_APOIO.test(c))
    throw new RecusaApoio(
      'codigo-invalido',
      `O ${campo} no apoio aceita só letras, números, ".", "-" e "_" (até 30).`,
    );
  return c;
}

/** O fator de conversão do analito (o valor recebido vezes o fator dá a unidade local): positivo e finito. */
export function conferirFatorConversao(fator: number): number {
  if (!Number.isFinite(fator) || fator <= 0 || fator > 1_000_000)
    throw new RecusaApoio('fator-invalido', 'O fator de conversão precisa ser positivo (até 1.000.000).');
  return fator;
}
