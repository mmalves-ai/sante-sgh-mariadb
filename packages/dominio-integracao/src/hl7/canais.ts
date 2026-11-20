// Canais HL7 v2 do motor de integração (Open Integration Engine; M34, regra 12; cap-12 §12.3): versionados no
// repositório (infra/oie/canais/<canal>.xml, implantados pelo CI na API do motor), cada um com a mensagem, a direção e
// o destino. O Sante SGH guarda a outbox, o estado e a trilha; o motor transforma e entrega. Nenhum canal repete o que
// um gatilho do legado já envia (a classificação externa: gatilho OU motor, nunca os dois, e só com a DP-16). O
// retorno do laboratório de apoio (ORU^R01) entra pela entrada idempotente da API (D-OIE-34), não por canal do motor.
export interface DefinicaoCanalOie {
  readonly canal: string;
  readonly versao: string;
  readonly descricao: string;
  readonly mensagem: string;
  readonly direcao: 'saida' | 'entrada';
  /** Quem recebe: o laboratório de apoio, a ferramenta de classificação de risco, o Sante SGH (entrada). */
  readonly destino: string;
  /** O arquivo do canal no repositório. */
  readonly arquivo: string;
  /** Porta MLLP de escuta do canal no motor (entrada do Sante SGH no motor). */
  readonly portaMllp: number;
  /** Chave de liberação que liga o canal (POL-3). */
  readonly chave: string;
}

export const CANAIS_OIE: readonly DefinicaoCanalOie[] = [
  {
    canal: 'oie-apoio-orm',
    versao: '1.0.0',
    descricao:
      'Pedido de exame ao laboratório de apoio (o exame no código do laboratório pelo de-para), com o ACK do laboratório.',
    mensagem: 'ORM^O01',
    direcao: 'saida',
    destino: 'Laboratório de apoio',
    arquivo: 'infra/oie/canais/oie-apoio-orm.xml',
    portaMllp: 6661,
    chave: 'integracao.apoio',
  },
  {
    canal: 'oie-classificacao-adt',
    versao: '1.0.0',
    descricao:
      'Admissão no pronto atendimento para a classificação de risco externa (só se a DP-16 confirmar e o gatilho em uso for desligado para ela).',
    mensagem: 'ADT^A04',
    direcao: 'saida',
    destino: 'Classificação de risco externa',
    arquivo: 'infra/oie/canais/oie-classificacao-adt.xml',
    portaMllp: 6663,
    chave: 'integracao.classificacaoExterna',
  },
];

export function canalOie(canal: string): DefinicaoCanalOie | undefined {
  return CANAIS_OIE.find((c) => c.canal === canal);
}
