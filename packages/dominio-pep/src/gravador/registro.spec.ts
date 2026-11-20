// Prova do gravador nos modelos reais (estrutura em docs/marcos/M09/dfm, respostas SINTÉTICAS): respostas →
// linhas → leitura (ida e volta: as mesmas respostas); as linhas lidas pelo leitor do M15 × o formulário que o
// próprio novo produziu (conferência cruzada: 100% nos 10 de maior uso e em todos os que o gravador grava); o
// texto do registro, o formulário e o documento legíveis pelos leitores do M15 (regra 8: o registro abre com o
// layout que ele carrega). Regra 9: RTF de ida e volta com corpus CP1252 de termos clínicos.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODELOS_ESCOPO_MINIMO, type Paragrafo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { lerDocumentoEmitido, lerLayoutEpoca } from '../prontuario/formulario.js';
import { rtfParaTexto, textoCorrido } from '../prontuario/rtf.js';
import { linhasDasRespostas } from './colunas.js';
import { respostasDasLinhas } from './leitura.js';
import { blocosDoRegistro, comoLidas, conferirGravado, montarRegistro, rtfLegivel } from './registro.js';
import { escaparRtf, paragrafosDoTexto, rtfDoCampo, rtfDoRegistro } from './rtf.js';
import { MARCA_SINTETICA_PEP, respostasSinteticas } from './sintetico.js';
import type { CabecalhoDocumento } from './xml.js';

const pasta = resolve(import.meta.dirname, '../../../../docs/marcos/M09/dfm');
const reps = readdirSync(pasta)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(pasta, f), 'utf8')) as RepresentacaoFormulario);
const porCodigo = new Map(reps.map((r) => [r.modelo.codigo ?? '', r]));
const form = (r: RepresentacaoFormulario) => ({
  modelo: r.modelo.id,
  tipoComposicao: 2,
  nomeTipoComposicao: 'Evolução',
  descricaoModelo: r.modelo.descricao ?? '',
});
const cab: CabecalhoDocumento = {
  hospital: [
    ['id_tbhospit', 1],
    ['nome', `HOSPITAL ${MARCA_SINTETICA_PEP}`],
  ],
  paciente: [
    ['id_htpaciente', 10],
    ['nome', `PACIENTE ${MARCA_SINTETICA_PEP}`],
    ['cpf', '00000000191'],
  ],
  atendimento: [
    ['registro', 7],
    ['localizacao', [['unidade_atendimento', [['nome', 'UNIDADE']]]]],
  ],
  lancamento: [
    ['tipo_assinatura', 'Evolução'],
    ['situacao_documento', 'Lançado'],
    ['data_hora_evento', '2026-07-05T10:00:00.0000-03:00'],
    ['profissional_evento', [['nome', `PROFISSIONAL ${MARCA_SINTETICA_PEP}`]]],
  ],
};

describe('os 10 modelos de maior uso: gravar e reler (ficha, seção 1)', () => {
  it('estão todos nas representações convertidas', () => {
    for (const c of MODELOS_ESCOPO_MINIMO) expect(porCodigo.has(c), c).toBe(true);
  });
  it.each(MODELOS_ESCOPO_MINIMO)('%s: ida e volta das respostas e conferência cruzada 100%%', (codigo) => {
    const rep = porCodigo.get(codigo)!;
    const respostas = respostasSinteticas(rep, { acentos: true });
    expect(respostas.length).toBeGreaterThan(0);
    const m = montarRegistro(rep, respostas, form(rep));
    // Ida e volta: as linhas relidas dão as mesmas respostas.
    const volta = respostasDasLinhas(rep, comoLidas(m.linhas), { soAtivos: true });
    expect(volta.ignoradas).toBe(0);
    const norm = (l: typeof respostas) =>
      [...l]
        .sort((a, b) => a.vinculo - b.vinculo)
        .map((x) => ({ vinculo: x.vinculo, valor: JSON.stringify(x.valor) }));
    expect(norm(volta.respostas)).toEqual(norm(respostas));
    // Conferência cruzada: as linhas lidas pelo leitor do M15 × o formulário gravado.
    const xml = m.xml(123);
    const c = conferirGravado(rep, comoLidas(m.linhas), xml);
    expect(c.comparados).toBeGreaterThan(0);
    expect(c.iguais).toBe(c.comparados);
    // O formulário e o texto do registro são legíveis pelo leitor (layout da época e texto formatado).
    const layout = lerLayoutEpoca(xml);
    expect(layout.modelo).toBe(rep.modelo.id);
    expect(layout.campos.length).toBe(m.componentes.length);
    expect(rtfLegivel(m.rtf)).toBe(true);
    // O documento emitido abre com o cabeçalho e os mesmos campos.
    const doc = lerDocumentoEmitido(m.documento(123, cab), { mostrarDocumentos: false });
    expect(doc.campos.length).toBe(m.componentes.length);
    expect(doc.blocos.map((b) => b.titulo)).toEqual([
      'Estabelecimento',
      'Paciente',
      'Atendimento',
      'Lançamento',
    ]);
    expect(JSON.stringify(doc.blocos)).not.toContain('00000000191');
  });
});

describe('todos os modelos que o gravador grava', () => {
  it('conferência cruzada em todos os 67 (respostas sintéticas das perguntas gravadas)', () => {
    let comparados = 0;
    let iguais = 0;
    let modelos = 0;
    for (const rep of reps) {
      const respostas = respostasSinteticas(rep, { semente: 3 });
      if (respostas.length === 0) continue;
      const m = montarRegistro(rep, respostas, form(rep));
      const c = conferirGravado(rep, comoLidas(m.linhas), m.xml(1));
      comparados += c.comparados;
      iguais += c.iguais;
      modelos++;
    }
    expect(modelos).toBeGreaterThan(50);
    expect(iguais).toBe(comparados);
  });
});

describe('texto formatado: ida e volta (regra 9)', () => {
  const corpus = [
    'Paciente consciente, orientado, aceitou a dieta.',
    'Pressão arterial 120×80 mmHg; FC 72 bpm; Tax 36,8 ºC.',
    'Hipótese: insuficiência cardíaca congestiva — avaliação “urgente”.',
    'Conduta: dipirona 1 g EV 6/6 h se dor ≥ 4 é proibido? não: use 4 ou mais.',
    'Ação: coração, pulmão, abdômen; Nº do leito 12-A; custo € 0 (sem cobrança).',
    'Chaves {} e barra \\ no texto; tabulação\tentre colunas.',
  ].map((t) => t.replace('≥', '>='));
  it('cada parágrafo volta igual, com negrito e recuo', () => {
    const ps: Paragrafo[] = corpus.map((texto, i) => ({
      alinhamento: 'esquerda',
      recuo: i % 3,
      trechos: [
        { texto: texto.slice(0, 10), negrito: i % 2 === 0, italico: false, sublinhado: false, cor: 0 },
        { texto: texto.slice(10), negrito: false, italico: i === 3, sublinhado: i === 4, cor: 0 },
      ],
    }));
    const t = rtfParaTexto(rtfDoCampo(ps));
    expect(t.conteudoAtivoRemovido).toBe(0);
    const texto = (p: Paragrafo) => p.trechos.map((x) => x.texto).join('');
    expect(t.paragrafos.map(texto).filter(Boolean)).toEqual(corpus.map((c) => c.replace('\t', '\t')));
    const primeiro = t.paragrafos[0]!;
    expect(primeiro.trechos[0]!.negrito).toBe(true);
    expect(t.paragrafos[1]!.recuo).toBe(1);
    expect(t.paragrafos[2]!.recuo).toBe(2);
    expect(t.paragrafos[3]!.trechos.some((x) => x.italico)).toBe(true);
    expect(t.paragrafos[4]!.trechos.some((x) => x.sublinhado)).toBe(true);
  });
  it('só os comandos que o formulário de origem usa; caractere fora do CP1252 é recusado', () => {
    const rtf = rtfDoCampo(paragrafosDoTexto('ação'));
    expect(
      rtf.startsWith(
        '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1046{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}',
      ),
    ).toBe(true);
    expect(rtf).toContain("a\\'e7\\'e3o");
    expect(() => escaparRtf('emoji 😀')).toThrow('CP1252');
    expect(escaparRtf('a\r\nb')).toBe('a\\line b');
  });
  it('texto do registro: seção (negrito do vínculo), pergunta em \\li200 e valor em \\li600', () => {
    const rtf = rtfDoRegistro([
      { rotulo: '1 - SEÇÃO', nivel: 'secao', negrito: true },
      { rotulo: '1.1 - Turno', nivel: 'pergunta', negrito: false, naLinha: 'Diurno' },
      {
        rotulo: '1.2 - Evolução',
        nivel: 'pergunta',
        negrito: false,
        valor: paragrafosDoTexto('Estável\nSem queixas'),
      },
      { rotulo: '2 - OUTRA', nivel: 'secao', negrito: false },
    ]);
    expect(rtf).toContain("\\viewkind4\\uc1\\pard\\cf1\\b\\fs16 1 - SE\\'c7\\'c3O\\par");
    expect(rtf).toContain('\\pard\\li200\\b0 1.1 - Turno: Diurno\\par');
    expect(rtf).toContain("\\pard\\li600\\cf0 Est\\'e1vel\\par");
    expect(textoCorrido(rtfParaTexto(rtf))).toContain('1.2 - Evolução\nEstável\nSem queixas');
    expect(rtf).toContain('\\pard\\cf1 2 - OUTRA');
  });
  it('blocos numerados pela árvore, só o que tem resposta', () => {
    const rep = porCodigo.get('EVAM')!;
    const respostas = respostasSinteticas(rep, { maximo: 2 });
    const g = linhasDasRespostas(rep, respostas);
    const b = blocosDoRegistro(rep, g.respondidos, g.secoes);
    expect(b.map((x) => x.rotulo.split(' - ')[0])).toEqual(['1', '1.1', '1.2']);
  });
});
