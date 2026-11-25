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

export interface ExameDaAmostra {
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
  exames: readonly ExameDaAmostra[],
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
  exames: readonly ExameDaAmostra[],
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
