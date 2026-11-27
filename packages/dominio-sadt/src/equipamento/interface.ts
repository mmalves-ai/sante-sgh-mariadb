// Interface com os equipamentos do laboratório (F3.5, 05-SADT linha 13): as regras do cadastro da interface (coerência
// entre o protocolo, o modelo de comunicação e o sentido; o endereço que cada protocolo exige), do de-para de exames e
// de analitos (o código que o equipamento entende, o fator de conversão e as casas decimais), a montagem do pedido que
// vai ao equipamento e a leitura do resultado que volta. Regra pura: nada de banco nem de rede. A mensagem leva só a
// identificação da amostra e os códigos dos testes; nenhum dado da pessoa vai ao equipamento.

export type ProtocoloInterface = 'astm' | 'hl7' | 'arquivo' | 'serial' | 'servico_web' | 'outro';
export type PadraoMensagemModelo = 'astm' | 'hl7_v2' | 'hl7_fhir' | 'proprietario' | 'arquivo_texto';
export type SentidoInterface = 'unidirecional' | 'bidirecional';

export const PROTOCOLOS_INTERFACE: readonly ProtocoloInterface[] = [
  'astm',
  'hl7',
  'arquivo',
  'serial',
  'servico_web',
  'outro',
];

/** Os padrões de mensagem que cada protocolo sabe transportar. */
const PADROES_DO_PROTOCOLO: Readonly<Record<ProtocoloInterface, readonly PadraoMensagemModelo[]>> = {
  astm: ['astm'],
  hl7: ['hl7_v2', 'hl7_fhir'],
  arquivo: ['arquivo_texto', 'proprietario', 'astm', 'hl7_v2'],
  serial: ['astm', 'proprietario'],
  servico_web: ['hl7_fhir', 'proprietario'],
  outro: ['astm', 'hl7_v2', 'hl7_fhir', 'proprietario', 'arquivo_texto'],
};

export interface InterfaceEquipamento {
  readonly codigo: string;
  readonly descricao: string;
  readonly protocolo: ProtocoloInterface;
  readonly sentido: SentidoInterface;
  /** O padrão de mensagem e o sentido do modelo de comunicação escolhido (nulo: modelo não encontrado). */
  readonly padraoDoModelo: PadraoMensagemModelo | null;
  readonly sentidoDoModelo: SentidoInterface | null;
  readonly host: string | null;
  readonly porta: number | null;
  readonly caminhoEnvio: string | null;
  readonly caminhoRetorno: string | null;
  readonly enviaListaTrabalho: boolean;
  readonly recebeResultado: boolean;
  readonly importaComoLiberado: boolean;
  readonly revisaAutomaticamente: boolean;
  readonly assinaAutomaticamente: boolean;
  readonly ativo: boolean;
}

export interface ProblemaInterface {
  readonly campo: string;
  readonly mensagem: string;
}

const CODIGO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$/;
const vazio = (v: string | null) => v === null || v.trim() === '';

/** O código que o equipamento entende: até 30 caracteres, sem espaço nem separador de mensagem. */
export function codigoEquipamentoValido(codigo: string): boolean {
  return CODIGO.test(codigo);
}

/**
 * Confere o cadastro da interface e devolve todos os problemas de uma vez, cada um no seu campo. A interface inativa
 * pode ficar sem endereço (cadastro em preparação); a ativa precisa do que o protocolo exige para trafegar.
 */
export function conferirInterface(e: InterfaceEquipamento): ProblemaInterface[] {
  const p: ProblemaInterface[] = [];
  const falha = (campo: string, mensagem: string) => p.push({ campo, mensagem });
  if (!codigoEquipamentoValido(e.codigo))
    falha('codigo', 'O código da interface tem até 30 letras, números, ponto, hífen ou barra, sem espaço.');
  if (e.descricao.trim().length < 3) falha('descricao', 'Descreva a interface com pelo menos 3 letras.');
  if (e.padraoDoModelo === null) falha('modelo', 'Escolha o modelo de comunicação.');
  else if (!PADROES_DO_PROTOCOLO[e.protocolo].includes(e.padraoDoModelo))
    falha('protocolo', 'O protocolo não transporta o padrão de mensagem do modelo de comunicação escolhido.');
  if (e.sentidoDoModelo === 'unidirecional' && e.sentido === 'bidirecional')
    falha('sentido', 'O modelo de comunicação é de mão única: a interface não pode ser de mão dupla.');
  if (e.sentido === 'unidirecional' && e.enviaListaTrabalho)
    falha('enviaListaTrabalho', 'Interface de mão única só recebe resultado: não envia lista de trabalho.');
  if (!e.enviaListaTrabalho && !e.recebeResultado)
    falha('recebeResultado', 'A interface precisa enviar a lista de trabalho ou receber o resultado.');
  if (e.porta !== null && !(Number.isInteger(e.porta) && e.porta >= 1 && e.porta <= 65535))
    falha('porta', 'A porta de rede vai de 1 a 65535.');
  if (!e.recebeResultado && (e.importaComoLiberado || e.revisaAutomaticamente || e.assinaAutomaticamente))
    falha(
      'importaComoLiberado',
      'Só a interface que recebe resultado pode liberar, revisar ou assinar sozinha.',
    );
  if (e.assinaAutomaticamente && !e.importaComoLiberado)
    falha('assinaAutomaticamente', 'A assinatura automática só vale com o resultado entrando liberado.');
  if (e.ativo) {
    if ((e.protocolo === 'astm' || e.protocolo === 'hl7' || e.protocolo === 'servico_web') && vazio(e.host))
      falha('host', 'Informe o endereço do equipamento na rede.');
    if ((e.protocolo === 'astm' || e.protocolo === 'hl7') && e.porta === null)
      falha('porta', 'Informe a porta de rede do equipamento.');
    if (e.protocolo === 'arquivo') {
      if (e.recebeResultado && vazio(e.caminhoRetorno))
        falha('caminhoRetorno', 'Informe a pasta de onde os resultados são lidos.');
      if (e.enviaListaTrabalho && vazio(e.caminhoEnvio))
        falha('caminhoEnvio', 'Informe a pasta onde a lista de trabalho é entregue.');
    }
  }
  return p;
}

export interface DeParaExameEquipamento {
  readonly exame: number;
  /** Nulo: vale para qualquer material do exame. */
  readonly material: number | null;
  readonly codigo: string;
  readonly enviaAnalitos: boolean;
}

export interface DeParaAnalitoEquipamento {
  readonly analito: number;
  /** Nulo: vale para o analito em qualquer exame. */
  readonly exame: number | null;
  readonly codigo: string;
  readonly fator: number;
  readonly casas: number | null;
  readonly recebe: boolean;
}

/** Confere o de-para do exame contra os já cadastrados no equipamento (o par exame e material não se repete). */
export function conferirDeParaExame(
  novo: DeParaExameEquipamento,
  outros: readonly DeParaExameEquipamento[],
): ProblemaInterface[] {
  const p: ProblemaInterface[] = [];
  if (!codigoEquipamentoValido(novo.codigo))
    p.push({
      campo: 'codigo',
      mensagem: 'O código do exame no equipamento não pode ter espaço nem separador.',
    });
  if (outros.some((o) => o.exame === novo.exame && o.material === novo.material))
    p.push({ campo: 'exame', mensagem: 'Este exame já tem código neste equipamento para o mesmo material.' });
  return p;
}

/** Confere o de-para do analito: o código é único no equipamento, o fator é positivo e as casas vão de 0 a 6. */
export function conferirDeParaAnalito(
  novo: DeParaAnalitoEquipamento,
  outros: readonly DeParaAnalitoEquipamento[],
): ProblemaInterface[] {
  const p: ProblemaInterface[] = [];
  if (!codigoEquipamentoValido(novo.codigo))
    p.push({
      campo: 'codigo',
      mensagem: 'O código do analito no equipamento não pode ter espaço nem separador.',
    });
  if (outros.some((o) => o.codigo === novo.codigo))
    p.push({ campo: 'codigo', mensagem: 'Este código já está ligado a outro analito neste equipamento.' });
  if (!(Number.isFinite(novo.fator) && novo.fator > 0))
    p.push({ campo: 'fator', mensagem: 'O fator de conversão é um número maior que zero.' });
  if (novo.casas !== null && !(Number.isInteger(novo.casas) && novo.casas >= 0 && novo.casas <= 6))
    p.push({ campo: 'casas', mensagem: 'As casas decimais vão de 0 a 6.' });
  return p;
}

export interface ExameNoEquipamento {
  /** O exame pedido (item da requisição). */
  readonly item: number;
  readonly exame: number;
  readonly material: number | null;
  readonly analitos: readonly number[];
}

export interface TestePedido {
  readonly item: number;
  readonly codigo: string;
}

export interface PedidoEquipamento {
  readonly amostra: string;
  readonly testes: readonly TestePedido[];
  /** Exames pedidos que ficaram fora por falta de código no equipamento. */
  readonly semDePara: readonly number[];
}

/**
 * Monta o pedido de uma amostra: cada exame vira o código que o equipamento entende (o de-para do material do exame
 * vence o genérico). Com o envio por analito, vai um teste por analito que tem código. Código repetido não é reenviado.
 */
export function montarPedidoEquipamento(
  amostra: string,
  exames: readonly ExameNoEquipamento[],
  deParaExames: readonly DeParaExameEquipamento[],
  deParaAnalitos: readonly DeParaAnalitoEquipamento[],
): PedidoEquipamento {
  const testes: TestePedido[] = [];
  const semDePara: number[] = [];
  const enviados = new Set<string>();
  const incluir = (item: number, codigo: string) => {
    if (enviados.has(codigo)) return;
    enviados.add(codigo);
    testes.push({ item, codigo });
  };
  for (const e of exames) {
    const doExame = deParaExames.filter((d) => d.exame === e.exame);
    const d =
      doExame.find((x) => x.material !== null && x.material === e.material) ??
      doExame.find((x) => x.material === null);
    if (!d) {
      semDePara.push(e.item);
      continue;
    }
    if (!d.enviaAnalitos) {
      incluir(e.item, d.codigo);
      continue;
    }
    const porAnalito = e.analitos
      .map((a) => analitoNoExame(deParaAnalitos, a, e.exame))
      .filter((x): x is DeParaAnalitoEquipamento => x !== null);
    if (porAnalito.length === 0) incluir(e.item, d.codigo);
    for (const a of porAnalito) incluir(e.item, a.codigo);
  }
  return { amostra, testes, semDePara };
}

function analitoNoExame(
  deParaAnalitos: readonly DeParaAnalitoEquipamento[],
  analito: number,
  exame: number,
): DeParaAnalitoEquipamento | null {
  const doAnalito = deParaAnalitos.filter((d) => d.analito === analito);
  return doAnalito.find((d) => d.exame === exame) ?? doAnalito.find((d) => d.exame === null) ?? null;
}

export interface LeituraEquipamento {
  readonly codigo: string;
  /** O valor como o equipamento mandou (texto). */
  readonly valor: string;
}

export interface ValorDaInterface {
  readonly analito: number;
  readonly numero: number | null;
  readonly texto: string | null;
}

export interface LeiturasInterpretadas {
  /** Os valores de cada exame pedido, já na unidade local. */
  readonly porItem: ReadonlyMap<number, readonly ValorDaInterface[]>;
  /** Códigos recebidos sem de-para no equipamento (pendência do cadastro). */
  readonly semDePara: readonly string[];
  /** Códigos com de-para que não recebe resultado (controle, cálculo do equipamento). */
  readonly ignorados: readonly string[];
  /** Códigos com de-para cujo analito não pertence a nenhum exame pedido da amostra. */
  readonly semExame: readonly string[];
}

const NUMERO = /^[+-]?\d+(?:[.,]\d+)?$/;

/** O valor numérico do equipamento na unidade local: multiplica pelo fator e arredonda nas casas do de-para. */
export function converterValor(
  valor: string,
  fator: number,
  casas: number | null,
): ValorDaInterface['numero'] {
  const limpo = valor.trim();
  if (!NUMERO.test(limpo)) return null;
  const bruto = Number(limpo.replace(',', '.')) * fator;
  // Seis casas é a precisão do resultado gravado; sem casas no de-para o valor fica nela.
  const k = 10 ** (casas ?? 6);
  return Math.round((bruto + Number.EPSILON * Math.sign(bruto)) * k) / k;
}

/**
 * Leva as leituras do equipamento aos exames pedidos da amostra. A leitura repetida do mesmo código vale a última
 * (repetição na bancada). O valor que não é número puro (por exemplo "<0,1" ou "Reagente") entra como texto.
 */
export function interpretarLeituras(
  leituras: readonly LeituraEquipamento[],
  deParaAnalitos: readonly DeParaAnalitoEquipamento[],
  exames: readonly ExameNoEquipamento[],
): LeiturasInterpretadas {
  const ultima = new Map<string, string>();
  for (const l of leituras) ultima.set(l.codigo.trim(), l.valor);
  const porItem = new Map<number, ValorDaInterface[]>();
  const semDePara: string[] = [];
  const ignorados: string[] = [];
  const semExame: string[] = [];
  for (const [codigo, valor] of ultima) {
    const candidatos = deParaAnalitos.filter((d) => d.codigo === codigo);
    if (candidatos.length === 0) {
      semDePara.push(codigo);
      continue;
    }
    // O de-para preso a um exame só serve a ele; o genérico serve ao primeiro exame pedido que tem o analito.
    let destino: { item: number; d: DeParaAnalitoEquipamento } | null = null;
    for (const d of candidatos) {
      const e = exames.find(
        (x) => x.analitos.includes(d.analito) && (d.exame === null || d.exame === x.exame),
      );
      if (e && (destino === null || d.exame !== null)) destino = { item: e.item, d };
    }
    if (!destino) {
      semExame.push(codigo);
      continue;
    }
    if (!destino.d.recebe) {
      ignorados.push(codigo);
      continue;
    }
    const numero = converterValor(valor, destino.d.fator, destino.d.casas);
    const texto = numero === null ? valor.trim().slice(0, 2000) : null;
    if (numero === null && !texto) {
      ignorados.push(codigo);
      continue;
    }
    const lista = porItem.get(destino.item) ?? [];
    if (!lista.some((v) => v.analito === destino.d.analito))
      lista.push({ analito: destino.d.analito, numero, texto });
    porItem.set(destino.item, lista);
  }
  return { porItem, semDePara, ignorados, semExame };
}

// Mensagem ASTM (padrão LIS2-A2 / E1394): registros separados por retorno de carro, campos por barra vertical e
// componentes por circunflexo. O pedido leva o cabeçalho, a amostra com os testes e o fecho; o registro do paciente vai
// vazio de propósito.

/** O pedido de uma amostra em registros ASTM. */
export function montarAstmPedido(p: {
  readonly amostra: string;
  readonly testes: readonly string[];
  readonly urgente: boolean;
}): string {
  const testes = p.testes.map((t) => `^^^${t}`).join('\\');
  return ['H|\\^&', 'P|1', `O|1|${p.amostra}||${testes}|${p.urgente ? 'S' : 'R'}`, 'L|1|N'].join('\r') + '\r';
}

export interface AmostraLida {
  readonly amostra: string;
  readonly leituras: readonly LeituraEquipamento[];
}

/**
 * Lê os resultados de uma mensagem ASTM: cada registro de pedido (O) abre uma amostra e cada registro de resultado (R)
 * traz o código do teste e o valor. O registro do paciente é ignorado (nenhum dado da pessoa é lido do equipamento).
 */
export function lerAstmResultado(conteudo: string): { readonly amostras: readonly AmostraLida[] } {
  const amostras: { amostra: string; leituras: LeituraEquipamento[] }[] = [];
  let campo = '|';
  let componente = '^';
  for (const bruta of conteudo.split(/[\r\n]+/)) {
    // Tira os caracteres de controle e o número do quadro que alguns equipamentos deixam antes do registro.
    const linha = bruta.replace(/^[^A-Za-z]*/, '').trim();
    if (linha.length < 2) continue;
    const tipo = linha[0]!.toUpperCase();
    if (tipo === 'H') {
      campo = linha[1] ?? '|';
      componente = linha[3] ?? '^';
      continue;
    }
    const campos = linha.split(campo);
    if (tipo === 'O') {
      const amostra = (campos[2] ?? '').split(componente)[0]!.trim();
      if (amostra) amostras.push({ amostra, leituras: [] });
    } else if (tipo === 'R') {
      const atual = amostras[amostras.length - 1];
      if (!atual) continue;
      const partes = (campos[2] ?? '').split(componente).map((x) => x.trim());
      const codigo = partes[3] || partes.find((x) => x !== '') || '';
      const valor = (campos[3] ?? '').split(componente)[0]!.trim();
      if (codigo && valor) atual.leituras.push({ codigo, valor });
    }
  }
  return { amostras };
}

// Protocolo de baixo nível ASTM E1381 (LIS01-A2): a mensagem vai em quadros de até 240 caracteres, cada um com o número
// do quadro (1 a 7 e 0, em ciclo), o texto, o fim do quadro (ETB, intermediário; ETX, o último do registro), a soma de
// conferência em dois dígitos hexadecimais e CR LF. O remetente abre com ENQ e fecha com EOT; o receptor responde ACK
// (aceito) ou NAK (repetir o quadro).
export const ASTM_CONTROLE = {
  ENQ: '\x05',
  ACK: '\x06',
  NAK: '\x15',
  EOT: '\x04',
  STX: '\x02',
  ETX: '\x03',
  ETB: '\x17',
} as const;
/** Texto máximo de um quadro (E1381). */
export const ASTM_TAMANHO_QUADRO = 240;
/** Tentativas de um quadro recusado com NAK antes de desistir (E1381: seis). */
export const ASTM_TENTATIVAS_QUADRO = 6;

/** Soma de conferência do quadro: soma dos bytes do número do quadro até o ETB/ETX, módulo 256, em hexadecimal. */
export function somaAstm(corpo: string): string {
  let s = 0;
  for (let i = 0; i < corpo.length; i++) s = (s + (corpo.charCodeAt(i) & 0xff)) % 256;
  return s.toString(16).toUpperCase().padStart(2, '0');
}

/** Os quadros E1381 da mensagem (cada registro termina em quadro com ETX; o registro longo é partido com ETB). */
export function quadrosAstm(mensagem: string): string[] {
  const { STX, ETX, ETB } = ASTM_CONTROLE;
  const quadros: string[] = [];
  let numero = 1;
  for (const registro of mensagem.split('\r').filter((r) => r !== '')) {
    const texto = `${registro}\r`;
    for (let i = 0; i < texto.length; i += ASTM_TAMANHO_QUADRO) {
      const parte = texto.slice(i, i + ASTM_TAMANHO_QUADRO);
      const corpo = `${numero}${parte}${i + ASTM_TAMANHO_QUADRO >= texto.length ? ETX : ETB}`;
      quadros.push(`${STX}${corpo}${somaAstm(corpo)}\r\n`);
      numero = (numero + 1) % 8;
    }
  }
  return quadros;
}

/** Confere um quadro recebido: a soma bate? Devolve o texto (sem o número) e se fecha o registro. */
export function lerQuadroAstm(
  quadro: string,
): { readonly valido: true; readonly texto: string; readonly fim: boolean } | { readonly valido: false } {
  const { STX, ETX, ETB } = ASTM_CONTROLE;
  const ini = quadro.indexOf(STX);
  const fimEtx = quadro.indexOf(ETX, ini + 1);
  const fimEtb = quadro.indexOf(ETB, ini + 1);
  const fim = fimEtx >= 0 && (fimEtb < 0 || fimEtx < fimEtb) ? fimEtx : fimEtb;
  if (ini < 0 || fim < 0 || quadro.length < fim + 3) return { valido: false };
  const corpo = quadro.slice(ini + 1, fim + 1);
  const soma = quadro.slice(fim + 1, fim + 3).toUpperCase();
  if (!/^[0-7]/.test(corpo) || somaAstm(corpo) !== soma) return { valido: false };
  return { valido: true, texto: corpo.slice(1, -1), fim: quadro[fim] === ETX };
}

// HL7 v2 (2.5.1): o pedido vai como ORM^O01 (um OBR por teste, a amostra no número do pedido) e o resultado volta como
// ORU^R01 (OBR com a amostra; cada OBX traz o código do teste e o valor). PID vai vazio: nenhum dado da pessoa sai.

/** O pedido de uma amostra em HL7 v2 (ORM^O01). */
export function montarHl7Pedido(p: {
  readonly amostra: string;
  readonly testes: readonly string[];
  readonly urgente: boolean;
  readonly controle: string;
  readonly quando: string;
}): string {
  const segmentos = [
    `MSH|^~\\&|SGH|LAB|EQUIPAMENTO|LAB|${p.quando}||ORM^O01|${p.controle}|P|2.5.1`,
    'PID|1',
    `ORC|NW|${p.amostra}`,
    ...p.testes.map((t, i) => `OBR|${i + 1}|${p.amostra}||^^^${t}|${p.urgente ? 'S' : 'R'}`),
  ];
  return segmentos.join('\r') + '\r';
}

/**
 * Lê o resultado em HL7 v2 (ORU^R01): cada OBR abre a amostra (pedido do sistema, OBR-2, ou do executante, OBR-3) e cada
 * OBX traz o código (OBX-3, o identificador ou o 4º componente quando o equipamento usa o formato ^^^código) e o valor
 * (OBX-5). O PID é ignorado. Devolve também o controle da mensagem (MSH-10), que serve de chave contra repetição.
 */
export function lerHl7Resultado(conteudo: string): {
  readonly controle: string;
  readonly amostras: readonly AmostraLida[];
} {
  const amostras: { amostra: string; leituras: LeituraEquipamento[] }[] = [];
  let campo = '|';
  let componente = '^';
  let controle = '';
  for (const bruta of conteudo.split(/[\r\n]+/)) {
    const linha = bruta.replace(/^[^A-Za-z]*/, '').trim();
    if (linha.length < 4) continue;
    const tipo = linha.slice(0, 3).toUpperCase();
    if (tipo === 'MSH') {
      campo = linha[3] ?? '|';
      componente = linha[4] ?? '^';
      // No MSH o separador é o campo 1: o controle (MSH-10) fica na posição 9 do split.
      controle = (linha.split(campo)[9] ?? '').trim();
      continue;
    }
    const campos = linha.split(campo);
    if (tipo === 'OBR') {
      const amostra = (
        (campos[2] ?? '').split(componente)[0] ||
        (campos[3] ?? '').split(componente)[0] ||
        ''
      ).trim();
      if (amostra) amostras.push({ amostra, leituras: [] });
    } else if (tipo === 'OBX') {
      const atual = amostras[amostras.length - 1];
      if (!atual) continue;
      const partes = (campos[3] ?? '').split(componente).map((x) => x.trim());
      const codigo = partes[0] || partes[3] || partes.find((x) => x !== '') || '';
      const valor = (campos[5] ?? '').split(componente)[0]!.trim();
      if (codigo && valor) atual.leituras.push({ codigo, valor });
    }
  }
  return { controle, amostras };
}
