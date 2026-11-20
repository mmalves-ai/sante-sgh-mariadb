// Documentos da manutenção em PDF/A (M55, etapa 1; ficha, seção 10, "Documento: OS e laudo em PDF/A"): o Gotenberg
// converte o HTML em PDF/A-2b (conferido pelo veraPDF no teste de integração dos documentos), como o termo de baixa do
// patrimônio (M54.6). Relidos do banco (a OS com o histórico e os custos; a execução do plano com o equipamento), nunca
// o que a tela mostrou, com a conta dos custos impressa. Autocontidos: nenhum recurso externo. Nenhum dado de paciente.
import {
  ATIVIDADES_PLANO,
  CAUSAS_FALHA,
  CLASSES_RISCO,
  CRITICIDADES_EQUIPAMENTO,
  DESTINOS_DESCARTE,
  EXECUTORES,
  FAIXAS_OBSOLESCENCIA,
  NATUREZAS_OS,
  PRIORIDADES_OS,
  RESULTADOS_EXECUCAO,
  SITUACOES_PLANO,
  SITUACOES_OS,
  SITUACOES_EQUIPAMENTO,
  SITUACOES_PRAZO_OS,
  TIPOS_EQUIPAMENTO,
  TIPOS_EVENTO_CICLO,
  type ClasseRisco,
  type CriticidadeEquipamento,
  type DestinoDescarte,
  type EquipamentoDetalhe,
  type IndiceObsolescencia,
  type ResultadoExecucao,
  type ResponsavelPmoc,
  type SituacaoPlano,
  type SituacaoEquipamento,
  type TipoEquipamento,
  type TipoEventoCiclo,
  type ExecucaoPlano,
  type OsDetalhe,
  type AtividadePlano,
  type UnidadePeriodicidade,
} from '@sgh/contratos';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
/** Os custos da OS chegam em reais com 2 casas (gravados em centavos). */
const reais = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
/** Instante `AAAA-MM-DDTHH:MM...` como `DD/MM/AAAA HH:MM` (o relógio do banco, sem conversão de fuso). */
const instanteBr = (d: string | null) => (d ? `${dataBr(d)} ${d.slice(11, 16)}`.trim() : '—');
const ESTILO = `body{font-family:sans-serif;font-size:10pt;margin:16mm}h1{font-size:14pt}h2{font-size:11pt;margin-top:14px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}
tbody th{width:35%}td.v{text-align:right}
.assinaturas{display:flex;gap:24px;margin-top:36px}.assinaturas div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}`;
const linha = (rotulo: string, valor: string) =>
  `<tr><th scope="row">${esc(rotulo)}</th><td>${esc(valor)}</td></tr>`;
const valor = (rotulo: string, v: number) =>
  `<tr><th scope="row">${esc(rotulo)}</th><td class="v">${reais(v)}</td></tr>`;
const pagina = (titulo: string, corpo: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;

interface Emissao {
  readonly estabelecimento: string;
  readonly emitidoEm: string;
  readonly emitidoPor: string;
}

export interface OsParaDocumento extends Emissao {
  readonly os: OsDetalhe;
}

/** A ordem de serviço com os prazos, a parada, o reparo, os custos (com a conta) e o histórico. */
export function htmlOrdemServico(t: OsParaDocumento): string {
  const o = t.os;
  const prazo = (p: OsDetalhe['atendimento']) =>
    `${instanteBr(p.limite)} (${SITUACOES_PRAZO_OS[p.situacao]})`;
  const historico = o.eventos
    .map(
      (e) =>
        `<tr><td>${esc(instanteBr(e.em))}</td><td>${esc(e.ator)}</td><td>${esc(
          e.de ? `${SITUACOES_OS[e.de]} → ${SITUACOES_OS[e.para]}` : SITUACOES_OS[e.para],
        )}</td><td>${esc(e.nota ?? '')}</td></tr>`,
    )
    .join('\n');
  const c = o.custos;
  const corpo = `<h1>Ordem de serviço nº ${esc(o.numero)}</h1>
<p>${esc(t.estabelecimento)} · ${esc(NATUREZAS_OS[o.natureza])} · prioridade ${esc(PRIORIDADES_OS[o.prioridade])} · ${esc(SITUACOES_OS[o.situacao])}</p>
<table><tbody>
${linha('Equipamento', o.equipamento ? `${o.equipamento.codigo} ${o.equipamento.nome}${o.critico ? ' (crítico)' : ''}` : '—')}
${linha('Local', o.local ?? '—')}
${linha('Setor', o.setor.nome)}
${linha('Aberta em', `${instanteBr(o.abertaEm)} por ${o.solicitante}`)}
${linha('Contato', o.contato ?? '—')}
${linha('Descrição', o.descricao)}
${linha('Executor', `${EXECUTORES[o.executor]}${o.cobertura ? `: contrato ${o.cobertura.numero} (${o.cobertura.fornecedor.nome})` : ''}`)}
${linha('Técnico', o.tecnico ?? '—')}
${linha('Prazo de atendimento', prazo(o.atendimento))}
${linha('Prazo de solução', prazo(o.solucao))}
${linha('Equipamento parado', o.paradaInicio ? `de ${instanteBr(o.paradaInicio)} a ${instanteBr(o.paradaFim)}` : 'não')}
${linha('Reparo', o.inicioReparo ? `de ${instanteBr(o.inicioReparo)} a ${instanteBr(o.fimReparo)}` : '—')}
${linha('Causa', o.causa ? CAUSAS_FALHA[o.causa] : '—')}
${linha('Solução', o.solucaoTexto ?? '—')}
${linha('Laudo ou relatório técnico', o.laudo === null ? '—' : `documento nº ${o.laudo}`)}
</tbody></table>
<table><tbody>
${valor('Peças', c.pecas)}
${valor('Mão de obra', c.maoDeObra)}
${valor('Terceiros', c.terceiros)}
${valor('Custo total', c.total)}
</tbody></table>
<p>Conta: ${reais(c.pecas)} + ${reais(c.maoDeObra)} + ${reais(c.terceiros)} = ${reais(c.total)} (custo total).</p>
<h2>Histórico</h2>
<table><thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">Situação</th><th scope="col">Nota</th></tr></thead>
<tbody>
${historico || '<tr><td colspan="4">—</td></tr>'}
</tbody></table>
<div class="assinaturas"><div>Técnico responsável</div><div>Solicitante (aceite)</div></div>
<p>Emitido em ${dataBr(t.emitidoEm)} por ${esc(t.emitidoPor)}.</p>`;
  return pagina(`Ordem de serviço ${o.numero}`, corpo);
}

export interface LaudoParaDocumento extends Emissao {
  readonly equipamento: EquipamentoDetalhe;
  readonly plano: {
    readonly id: number;
    readonly atividade: AtividadePlano;
    readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
    readonly procedimento: string | null;
  };
  readonly execucao: ExecucaoPlano;
  /** Número da corretiva aberta pela execução reprovada (nulo: nenhuma). */
  readonly corretiva: string | null;
}

/** O registro da execução do plano (preventiva, calibração, segurança elétrica, inspeção): o laudo do equipamento. */
export function htmlLaudoExecucao(t: LaudoParaDocumento): string {
  const { equipamento: e, plano: p, execucao: x } = t;
  const corpo = `<h1>Laudo de ${esc(ATIVIDADES_PLANO[p.atividade].toLowerCase())} nº ${x.id}</h1>
<p>${esc(t.estabelecimento)} · resultado: ${esc(RESULTADOS_EXECUCAO[x.resultado])}</p>
<table><tbody>
${linha('Equipamento', `${e.codigo} ${e.nome}`)}
${linha('Fabricante, modelo e série', [e.fabricante, e.modelo, e.numeroSerie].filter(Boolean).join(' · ') || '—')}
${linha('Registro na Anvisa', e.registroAnvisa ?? '—')}
${linha('Criticidade', CRITICIDADES_EQUIPAMENTO[e.criticidade])}
${linha('Classe de risco', e.classeRisco ? CLASSES_RISCO[e.classeRisco] : '—')}
${linha('Setor', e.setor?.nome ?? '—')}
${linha('Atividade', ATIVIDADES_PLANO[p.atividade])}
${linha('Periodicidade', `a cada ${p.periodicidade.quantidade} ${p.periodicidade.unidade}`)}
${linha('Procedimento', p.procedimento ?? '—')}
${linha('Data da execução', dataBr(x.data))}
${linha('Resultado', RESULTADOS_EXECUCAO[x.resultado])}
${linha('Certificado do padrão', x.certificadoPadrao ?? '—')}
${linha('Laudo ou relatório técnico', x.laudo === null ? '—' : `documento nº ${x.laudo}`)}
${linha('Observação', x.observacao ?? '—')}
${linha('Corretiva aberta', t.corretiva ?? '—')}
${linha('Registrada por', x.por)}
</tbody></table>
<div class="assinaturas"><div>Responsável técnico pela execução</div><div>Engenharia clínica</div></div>
<p>Emitido em ${dataBr(t.emitidoEm)} por ${esc(t.emitidoPor)}.</p>`;
  return pagina(`Laudo ${x.id} · ${e.codigo}`, corpo);
}

// ── Plano de gerenciamento das tecnologias em saúde (W0-08, parte 9b2; mercado M3; RDC 509/2021, arts. 8º, 15 e 16) ──

export interface EquipamentoDoPgts {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly classeRisco: ClasseRisco | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly registroAnvisa: string | null;
  readonly setor: string;
  readonly situacao: SituacaoEquipamento;
  /** Nulo: o equipamento foi descartado (fica só no histórico do ciclo de vida). */
  readonly indice: IndiceObsolescencia | null;
}

export interface ModeloDoPgts {
  readonly fabricante: string;
  readonly modelo: string;
  readonly equipamentos: number;
  readonly cursos: readonly {
    readonly codigo: string;
    readonly titulo: string;
    readonly validadeMeses: number;
  }[];
  readonly aptos: number;
  readonly pendentes: number;
}

export interface EventoDoPgts {
  readonly equipamento: string;
  readonly tipo: TipoEventoCiclo;
  readonly data: string;
  readonly motivo: string;
  readonly documento: string | null;
  readonly destino: DestinoDescarte | null;
  readonly autorizadoPor: string;
}

export interface PlanoDoPgts {
  readonly equipamento: string;
  readonly atividade: AtividadePlano;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly ativo: boolean;
  readonly ultimaExecucao: string | null;
  readonly ultimoResultado: ResultadoExecucao | null;
}

export interface PgtsParaDocumento extends Emissao {
  readonly equipamentos: readonly EquipamentoDoPgts[];
  readonly modelos: readonly ModeloDoPgts[];
  readonly eventos: readonly EventoDoPgts[];
  readonly planos: readonly PlanoDoPgts[];
}

const tabela = (cabecalho: readonly string[], linhas: readonly string[], vazio = '—') =>
  `<table><thead><tr>${cabecalho.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>
${linhas.join('\n') || `<tr><td colspan="${cabecalho.length}">${esc(vazio)}</td></tr>`}
</tbody></table>`;
const celulas = (xs: readonly string[]) => `<tr>${xs.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`;

/** Contagem por chave, na ordem do vocabulário, com a soma impressa com as parcelas. */
function contagem<K extends string>(
  rotulo: string,
  vocab: Record<K, string>,
  chaves: readonly (K | null)[],
  semValor: string,
): string {
  const linhas: [string, number][] = (Object.keys(vocab) as K[]).map((k) => [
    vocab[k],
    chaves.filter((c) => c === k).length,
  ]);
  const sem = chaves.filter((c) => c === null).length;
  if (sem) linhas.push([semValor, sem]);
  const usadas = linhas.filter(([, n]) => n > 0);
  return `${tabela(
    [rotulo, 'Equipamentos'],
    usadas.map(([r, n]) => `<tr><td>${esc(r)}</td><td class="v">${n}</td></tr>`),
  )}
<p>Conta: ${usadas.map(([, n]) => n).join(' + ') || '0'} = ${chaves.length} equipamentos.</p>`;
}

/**
 * O plano de gerenciamento das tecnologias em saúde (RDC 509/2021) gerado do cadastro: o inventário do parque por tipo,
 * criticidade e classe de risco; o treinamento exigido por modelo com os aptos; o índice de obsolescência de cada
 * equipamento com as parcelas; os eventos do ciclo de vida (incorporação, desativação, descarte) e os planos de
 * manutenção. Só o que está gravado; nada de paciente.
 */
export function htmlPgts(t: PgtsParaDocumento): string {
  const noParque = t.equipamentos.filter((e) => e.indice !== null);
  const descartados = t.equipamentos.length - noParque.length;
  const inventario = noParque.map((e) =>
    celulas([
      e.codigo,
      e.nome,
      TIPOS_EQUIPAMENTO[e.tipo],
      CRITICIDADES_EQUIPAMENTO[e.criticidade],
      e.classeRisco ? CLASSES_RISCO[e.classeRisco] : '—',
      [e.fabricante, e.modelo, e.numeroSerie].filter(Boolean).join(' · ') || '—',
      e.registroAnvisa ?? '—',
      e.setor,
      SITUACOES_EQUIPAMENTO[e.situacao],
    ]),
  );
  const indices = noParque.map((e) => {
    const i = e.indice as IndiceObsolescencia;
    return celulas([
      `${e.codigo} ${e.nome}`,
      `${i.idade.pontos} de ${i.idade.peso}${i.idade.idadeMeses === null ? ' (sem data)' : ` (${i.idade.idadeMeses} de ${i.idade.vidaUtilMeses} meses)`}`,
      `${i.custo.pontos} de ${i.custo.peso}${i.custo.valorCent === null ? ' (sem bem)' : ` (${reais(i.custo.custoCent / 100)} de ${reais(i.custo.valorCent / 100)})`}`,
      `${i.falhas.pontos} de ${i.falhas.peso} (${i.falhas.corretivas} corretivas, teto ${i.falhas.teto})`,
      `${i.idade.pontos} + ${i.custo.pontos} + ${i.falhas.pontos} = ${i.indice}`,
      FAIXAS_OBSOLESCENCIA[i.faixa],
    ]);
  });
  const janela = noParque[0]?.indice?.janelaMeses ?? 12;
  const modelos = t.modelos.map((m) =>
    celulas([
      `${m.fabricante} ${m.modelo}`,
      String(m.equipamentos),
      m.cursos
        .map(
          (c) =>
            `${c.codigo} ${c.titulo} (validade ${c.validadeMeses ? `${c.validadeMeses} meses` : 'indeterminada'})`,
        )
        .join('; ') || '—',
      String(m.aptos),
      String(m.pendentes),
    ]),
  );
  const eventos = t.eventos.map((e) =>
    celulas([
      dataBr(e.data),
      e.equipamento,
      TIPOS_EVENTO_CICLO[e.tipo],
      e.motivo,
      [e.documento, e.destino ? DESTINOS_DESCARTE[e.destino] : null].filter(Boolean).join(' · ') || '—',
      e.autorizadoPor,
    ]),
  );
  const planos = t.planos.map((p) =>
    celulas([
      p.equipamento,
      ATIVIDADES_PLANO[p.atividade],
      `a cada ${p.periodicidade.quantidade} ${p.periodicidade.unidade}`,
      p.ativo ? 'Ativo' : 'Inativo',
      p.ultimaExecucao
        ? `${dataBr(p.ultimaExecucao)}${p.ultimoResultado ? ` (${RESULTADOS_EXECUCAO[p.ultimoResultado]})` : ''}`
        : '—',
    ]),
  );
  const corpo = `<h1>Plano de gerenciamento das tecnologias em saúde</h1>
<p>${esc(t.estabelecimento)} · RDC 509/2021 · ${noParque.length} equipamentos no parque${descartados ? `, ${descartados} descartados` : ''}</p>
<h2>1. Inventário por tipo</h2>
${contagem(
  'Tipo',
  TIPOS_EQUIPAMENTO,
  noParque.map((e) => e.tipo),
  '—',
)}
<h2>2. Inventário por criticidade</h2>
${contagem(
  'Criticidade',
  CRITICIDADES_EQUIPAMENTO,
  noParque.map((e) => e.criticidade),
  '—',
)}
<h2>3. Inventário por classe de risco</h2>
${contagem(
  'Classe de risco',
  CLASSES_RISCO,
  noParque.map((e) => e.classeRisco),
  'Sem classe de risco',
)}
<h2>4. Equipamentos do parque</h2>
${tabela(['Código', 'Nome', 'Tipo', 'Criticidade', 'Classe de risco', 'Fabricante, modelo e série', 'Registro na Anvisa', 'Setor', 'Situação'], inventario)}
<h2>5. Treinamento dos operadores por modelo</h2>
${tabela(['Modelo', 'Equipamentos', 'Cursos exigidos', 'Aptos', 'Pendentes'], modelos, 'Nenhum curso exigido.')}
<h2>6. Índice de obsolescência (janela de ${janela} meses)</h2>
${tabela(['Equipamento', 'Idade', 'Custo', 'Falhas', 'Índice', 'Faixa'], indices)}
<h2>7. Ciclo de vida (incorporação, desativação e descarte)</h2>
${tabela(['Data', 'Equipamento', 'Evento', 'Causa', 'Documento e destino', 'Autorizado por'], eventos, 'Nenhum evento registrado.')}
<h2>8. Planos de manutenção</h2>
${tabela(['Equipamento', 'Atividade', 'Periodicidade', 'Situação', 'Última execução'], planos, 'Nenhum plano.')}
<div class="assinaturas"><div>Responsável técnico pelo gerenciamento</div><div>Direção do estabelecimento</div></div>
<p>Emitido em ${dataBr(t.emitidoEm)} por ${esc(t.emitidoPor)}.</p>`;
  return pagina('Plano de gerenciamento das tecnologias em saúde', corpo);
}

// ── Relatório do PMOC (W0-08, parte 10, mercado M4) ──────────────────────────────────────────────────────────────────

export interface ItemDoPmoc {
  readonly plano: number;
  readonly versaoModelo: number;
  readonly equipamento: {
    readonly codigo: string;
    readonly nome: string;
    readonly local: string;
    readonly fabricante: string | null;
    readonly modelo: string | null;
    readonly numeroSerie: string | null;
  };
  readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
  readonly ativo: boolean;
  readonly proxima: string | null;
  readonly situacao: SituacaoPlano | null;
  readonly execucoes: readonly {
    readonly data: string;
    readonly resultado: ResultadoExecucao;
    readonly laudo: number | null;
    readonly observacao: string | null;
    readonly por: string;
  }[];
}

export interface PmocParaDocumento extends Emissao {
  readonly de: string;
  readonly ate: string;
  readonly norma: string;
  readonly responsavel: ResponsavelPmoc;
  readonly itens: readonly ItemDoPmoc[];
}

const periodo = (p: { quantidade: number; unidade: UnidadePeriodicidade }) =>
  `${p.quantidade} ${p.unidade === 'dias' ? (p.quantidade === 1 ? 'dia' : 'dias') : p.quantidade === 1 ? 'mês' : 'meses'}`;

/**
 * O relatório do PMOC do período (Lei 13.589/2018; Portaria GM/MS 3.523/1998): a identificação do responsável técnico,
 * os equipamentos de climatização com o plano, a situação de hoje e as execuções do período com o resultado e o laudo,
 * a contagem com as parcelas e a assinatura do responsável técnico (nome, registro e ART impressos).
 */
export function htmlPmoc(t: PmocParaDocumento): string {
  const rt = t.responsavel;
  const equipamentos = t.itens.map((i) =>
    celulas([
      i.equipamento.codigo,
      i.equipamento.nome,
      i.equipamento.local,
      [i.equipamento.fabricante, i.equipamento.modelo, i.equipamento.numeroSerie]
        .filter(Boolean)
        .join(' · ') || '—',
      `${periodo(i.periodicidade)} (plano ${i.plano}, modelo v${i.versaoModelo})`,
      i.ativo && i.situacao
        ? `${SITUACOES_PLANO[i.situacao]}; próxima ${dataBr(i.proxima)}`
        : 'Plano desativado',
    ]),
  );
  const execucoes = t.itens.flatMap((i) =>
    i.execucoes.map((e) =>
      celulas([
        dataBr(e.data),
        i.equipamento.codigo,
        RESULTADOS_EXECUCAO[e.resultado],
        e.laudo === null ? '—' : `Documento ${e.laudo}`,
        e.observacao ?? '—',
        e.por,
      ]),
    ),
  );
  const parcelas = t.itens.map((i) => i.execucoes.length);
  const total = parcelas.reduce((a, b) => a + b, 0);
  const reprovadas = t.itens.flatMap((i) => i.execucoes).filter((e) => e.resultado === 'reprovado').length;
  const corpo = `<h1>Relatório do PMOC</h1>
<p>Plano de manutenção, operação e controle dos sistemas de climatização. ${esc(t.norma)}.</p>
<table><tbody>
${linha('Estabelecimento', t.estabelecimento)}
${linha('Período', `${dataBr(t.de)} a ${dataBr(t.ate)}`)}
${linha('Responsável técnico', rt.nome)}
${linha('Registro profissional', rt.registro)}
${linha('ART', rt.art ?? '—')}
</tbody></table>
<h2>1. Equipamentos de climatização no PMOC</h2>
${tabela(['Código', 'Equipamento', 'Local', 'Fabricante, modelo e série', 'Periodicidade', 'Situação hoje'], equipamentos, 'Nenhum plano do PMOC.')}
<p>Conta: ${t.itens.length} equipamentos no PMOC.</p>
<h2>2. Execuções do período</h2>
${tabela(['Data', 'Equipamento', 'Resultado', 'Laudo', 'Observação', 'Executado por'], execucoes, 'Nenhuma execução no período.')}
<p>Conta: ${parcelas.join(' + ') || '0'} = ${total} execuções no período (${reprovadas} reprovadas).</p>
<h2>3. Declaração do responsável técnico</h2>
<p>Declaro que o plano de manutenção, operação e controle dos sistemas de climatização deste estabelecimento foi
executado conforme as execuções registradas acima, no período informado.</p>
<div class="assinaturas"><div>${esc(rt.nome)}<br>${esc(rt.registro)}${rt.art ? `<br>ART ${esc(rt.art)}` : ''}<br>Responsável técnico do PMOC</div><div>Direção do estabelecimento</div></div>
<p>Emitido em ${dataBr(t.emitidoEm)} por ${esc(t.emitidoPor)}.</p>`;
  return pagina('Relatório do PMOC', corpo);
}
