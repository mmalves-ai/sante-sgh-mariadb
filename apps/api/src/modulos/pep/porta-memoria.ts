// Porta do prontuário em MEMÓRIA (M15): a sessão sintética de dev/ci (E2E) lê registros SINTÉTICOS dos
// pacientes sintéticos do cadastro (1001 e 1003), no mesmo formato que o banco guarda: texto formatado (RTF com
// os escapes do código de página), formulário gravado (XML), documento emitido comprimido (zlib + base64,
// decodificado pelo mesmo decodificador do adaptador) e respostas estruturadas com a definição do modelo (DFM
// sintético convertido pelo parser do M09). Nada aqui é dado de pessoa real (marca "SINTETICO"); nada vai à
// cópia. Cada estabelecimento tem os seus registros (IDs próprios): não há prontuário cruzado (regra 14). O
// registro de acesso lê a trilha em memória da API.
import { deflateSync } from 'node:zlib';
import { type AcessoLido, codificarCp1252, decodificarDocumentoEmitido, type DefinicaoFormularioLida, EVENTO_ALERTA_LEITURA, EVENTOS_LEITURA_PRONTUARIO, type ExcecaoAgregadaLida, type FontesLidas, type RegistroProntuarioLido, type RespostaLida } from './tipos-pep.js';
import type { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import type { ContextoProntuario, PortaProntuario } from './porta.js';

const M = 'SINTETICO';

function escaparXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Texto em RTF com os acentos como escapes do código de página (como o formulário grava). */
export function rtfSintetico(
  linhas: readonly { texto: string; negrito?: boolean; centro?: boolean }[],
): string {
  const esc = (t: string) =>
    [...t]
      .map((ch) => {
        const c = ch.charCodeAt(0);
        if (ch === '\\' || ch === '{' || ch === '}') return `\\${ch}`;
        if (c < 0x80) return ch;
        const b = codificarCp1252(ch)[0] ?? 0x3f;
        return `\\'${b.toString(16).padStart(2, '0')}`;
      })
      .join('');
  return (
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1046{\\fonttbl{\\f0\\fnil\\fcharset0 Tahoma;}}\r\n' +
    '{\\colortbl ;\\red0\\green0\\blue255;}\r\n\\viewkind4\\uc1' +
    linhas
      .map(
        (l) =>
          `\\pard${l.centro ? '\\qc' : ''}${l.negrito ? '\\cf1\\b ' : '\\cf0\\b0 '}${esc(l.texto)}${l.negrito ? '\\b0\\cf0' : ''}\\par\r\n`,
      )
      .join('') +
    '}'
  );
}

interface CampoSintetico {
  readonly ordem: string;
  readonly classe: string;
  readonly componente: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly valor: string;
  readonly opcoes?: readonly string[];
  readonly indice?: number;
}

/** Modelos sintéticos: 61 (evolução médica) e 62 (evolução de enfermagem), com as perguntas do formulário. */
const CAMPOS: Readonly<Record<number, readonly CampoSintetico[]>> = {
  61: [
    {
      ordem: '01',
      classe: 'TGroupBoxPep',
      componente: 'cmp1',
      titulo: 'EVOLUÇÃO MÉDICA',
      tipo: '1',
      valor: '',
    },
    {
      ordem: '0101',
      classe: 'TfRespTexto',
      componente: 'cmp2',
      titulo: 'Queixa principal',
      tipo: '5',
      valor: 'Dor torácica há 2 dias, não irradiada',
    },
    { ordem: '0102', classe: 'TfRespEdit', componente: 'cmp3', titulo: 'PA', tipo: '11', valor: '120x80' },
    {
      ordem: '0103',
      classe: 'TfRespComboBox',
      componente: 'cmp4',
      titulo: 'Dor ao esforço',
      tipo: '4',
      valor: 'Sim',
      opcoes: ['Não', 'Sim'],
      indice: 2,
    },
    {
      ordem: '0104',
      classe: 'TfRespTexto',
      componente: 'cmp5',
      titulo: 'Conduta',
      tipo: '5',
      valor: 'Observação e reavaliação em 6 horas',
    },
  ],
  62: [
    {
      ordem: '01',
      classe: 'TGroupBoxPep',
      componente: 'cmp11',
      titulo: 'EVOLUÇÃO DE ENFERMAGEM',
      tipo: '1',
      valor: '',
    },
    {
      ordem: '0101',
      classe: 'TfRespEdit',
      componente: 'cmp12',
      titulo: 'Temperatura',
      tipo: '11',
      valor: '36,8',
    },
    {
      ordem: '0102',
      classe: 'TfRespTexto',
      componente: 'cmp13',
      titulo: 'Anotação',
      tipo: '5',
      valor: 'Paciente consciente, orientado, aceitou a dieta',
    },
  ],
};

const NOMES_MODELO: Readonly<Record<number, { codigo: string; nome: string }>> = {
  61: { codigo: 'EVAM', nome: `EVOLUÇÃO MÉDICA ${M}` },
  62: { codigo: 'ENF091', nome: `EVOLUÇÃO DE ENFERMAGEM ${M}` },
};

function xmlFormulario(
  modelo: number,
  id: number,
  campos: readonly CampoSintetico[],
  documento: boolean,
): string {
  return (
    `<evolucao id_evolucao="${modelo}" id_prcabevol="${id}" id_prtpcomp="1" nomeComposicao="${NOMES_MODELO[modelo]?.codigo ?? ''}" tipo="1">` +
    campos
      .map((c, i) => {
        const valor = c.classe === 'TfRespTexto' && c.valor ? rtfSintetico([{ texto: c.valor }]) : c.valor;
        return (
          `<componente><className>${c.classe}</className><name>${c.componente}</name><top>${i * 24}</top><left>8</left>` +
          `<height>21</height><width>${c.classe === 'TfRespEdit' ? 160 : 744}</width>` +
          (documento ? '' : '<autopreenchido>F</autopreenchido><alergico_ao_item>F</alergico_ao_item>') +
          `<title>${escaparXml(c.titulo)}</title><value>${escaparXml(valor)}</value></componente>`
        );
      })
      .join('') +
    '</evolucao>'
  );
}

function documentoComprimido(r: RegistroSintetico, campos: readonly CampoSintetico[]): Buffer {
  const xml =
    '<?xml version="1.0" encoding="Windows-1252" standalone="no"?><documento><versaoXML>1</versaoXML>' +
    `<hospital><id_tbhospit>1</id_tbhospit><nome>HOSPITAL ${M}</nome><cnes>0000000</cnes></hospital>` +
    `<paciente><id_htpaciente>${r.idHtPaciente}</id_htpaciente><nome>${escaparXml(r.pacienteNome)}</nome><prontuario>${r.paciente}</prontuario>` +
    `<nascimento>1980-02-03</nascimento><sexo>F</sexo><cpf>00000000191</cpf></paciente>` +
    `<atendimento><registro>${r.atendimento}</registro><tipo_atendimento>Internação</tipo_atendimento><leito>101A</leito>` +
    `<medico_assistente><nome>ANA MÉDICA ${M}</nome><conselho>CRM</conselho><codigo_conselho>70001</codigo_conselho><uf_conselho>RJ</uf_conselho></medico_assistente>` +
    `<data_hora_entrada>${r.dataHora.slice(0, 10)} 07:00:00</data_hora_entrada><nome_convenio>CONVENIO ${M}</nome_convenio></atendimento>` +
    `<responsavel><nome>RESPONSÁVEL ${M}</nome><parentesco>Filho</parentesco></responsavel>` +
    `<lancamento><tipo_assinatura>Evolução</tipo_assinatura><situacao_documento>Lançado</situacao_documento>` +
    `<data_hora_evento>${r.dataHora.replace('T', ' ').slice(0, 19)}</data_hora_evento><profissional_evento><nome>${escaparXml(r.profissionalNome)}</nome></profissional_evento></lancamento>` +
    `<identificacao><id_prcabevol>${r.id}</id_prcabevol>${xmlFormulario(r.modelo, r.id, campos, true)}</identificacao></documento>`;
  return Buffer.from(deflateSync(codificarCp1252(xml)).toString('base64'), 'latin1');
}

interface RegistroSintetico extends RegistroProntuarioLido {
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly atendimento: number;
  readonly dataHora: string;
  readonly profissionalNome: string;
  readonly conteudo: boolean;
  readonly xml: boolean;
  readonly documento: boolean;
  readonly situacoes: readonly number[];
}

const PACIENTES: Readonly<Record<number, string>> = {
  1001: `JOSÉ DA SILVA ${M}`,
  1003: `CINTHYA GABRIELLA VIANNA ${M}`,
};

function registros(base: number): RegistroSintetico[] {
  const r = (
    x: Partial<RegistroSintetico> & Pick<RegistroSintetico, 'id' | 'paciente' | 'dataHora' | 'modelo'>,
  ): RegistroSintetico => ({
    idHtPaciente: x.paciente * 10,
    idHtAtendimento: 50,
    lancadoEm: x.dataHora,
    modeloCodigo: NOMES_MODELO[x.modelo]?.codigo ?? null,
    modeloNome: NOMES_MODELO[x.modelo]?.nome ?? null,
    registroProfissional: 10,
    profissional: 1000,
    profissionalNome: `ANA MÉDICA ${M}`,
    cbo: '225125',
    suspensoEm: null,
    justificativaSuspensao: null,
    corrigeRegistro: null,
    justificativaRetroativo: null,
    supervisor: null,
    pacienteNome: PACIENTES[x.paciente] ?? M,
    atendimento: 31337,
    conteudo: true,
    xml: true,
    documento: false,
    situacoes: [],
    ...x,
  });
  return [
    // 2026: documento emitido, com retroativo e supervisão.
    r({
      id: base + 6,
      paciente: 1003,
      dataHora: '2026-07-01T09:30:00.000',
      modelo: 61,
      documento: true,
      situacoes: [1],
      justificativaRetroativo: `Sistema fora do ar ${M}`,
      supervisor: 1001,
    }),
    // 2026: enfermagem (outra categoria profissional), com documento.
    r({
      id: base + 5,
      paciente: 1003,
      dataHora: '2026-06-30T22:10:00.000',
      modelo: 62,
      documento: true,
      situacoes: [1],
      profissional: 1002,
      profissionalNome: `CARLA ENFERMEIRA ${M}`,
      cbo: '223505',
      registroProfissional: 12,
    }),
    // 2024: documento lançado e depois suspenso.
    r({
      id: base + 4,
      paciente: 1003,
      dataHora: '2024-05-01T09:00:00.000',
      modelo: 61,
      documento: true,
      situacoes: [1, 2],
      suspensoEm: '2024-05-02T10:11:00.000',
      justificativaSuspensao: `Lançado no paciente errado ${M}`,
    }),
    // 2023: correção do registro de 2021.
    r({
      id: base + 3,
      paciente: 1003,
      dataHora: '2023-01-10T11:00:00.000',
      modelo: 61,
      corrigeRegistro: base + 1,
    }),
    // 2022: cabeçalho sem conteúdo (exceção que aparece).
    r({
      id: base + 2,
      paciente: 1003,
      dataHora: '2022-08-15T08:00:00.000',
      modelo: 62,
      conteudo: false,
      xml: false,
      profissional: 1002,
      profissionalNome: `CARLA ENFERMEIRA ${M}`,
      cbo: '223505',
    }),
    // 2021: sem documento emitido (o formulário da época).
    r({ id: base + 1, paciente: 1003, dataHora: '2021-03-02T14:20:00.000', modelo: 61 }),
    r({ id: base + 11, paciente: 1001, dataHora: '2026-05-05T10:00:00.000', modelo: 61 }),
    // M23 (regra 15): sessão de psicologia (o conteúdo fica restrito à categoria no novo).
    r({
      id: base + 12,
      paciente: 1001,
      dataHora: '2026-05-06T10:00:00.000',
      modelo: 61,
      profissional: 1005,
      profissionalNome: `PAULA PSICÓLOGA ${M}`,
      cbo: '251510',
      registroProfissional: 15,
    }),
  ];
}

function camposDe(r: RegistroSintetico): readonly CampoSintetico[] {
  const campos = CAMPOS[r.modelo] ?? [];
  // O registro de 2021 tem o layout da época: a pergunta "Conduta" ainda não existia.
  return r.dataHora.startsWith('2021') ? campos.filter((c) => c.ordem !== '0104') : campos;
}

function dfmDe(c: CampoSintetico): string {
  const linhas = [
    `inherited ${c.componente}: ${c.classe}`,
    `  Width = ${c.classe === 'TfRespEdit' ? 160 : 744}`,
    '  Height = 40',
    `  ${c.classe === 'TGroupBoxPep' ? 'Caption' : 'Description'} = '${c.titulo}'`,
    `  Ordem = '${c.ordem}'`,
    '  CampoObrigatorio = False',
  ];
  if (c.opcoes) {
    linhas.push(
      '  inherited cbxResp: TValidadeComboBox',
      '    Items.Strings = (',
      c.opcoes.map((o) => `      '${o}'`).join('\r\n') + ')',
      '  end',
    );
  }
  linhas.push('end');
  return linhas.join('\r\n');
}

export class PortaProntuarioMemoria implements PortaProntuario {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, RegistroSintetico[]>();
  private readonly codigos: string[] = [];

  constructor(private readonly trilha: RegistradorTrilhaMemoria | null = null) {}

  private dados(hospital: string): RegistroSintetico[] {
    let d = this.porHospital.get(hospital);
    if (!d) {
      if (!this.codigos.includes(hospital)) this.codigos.push(hospital);
      d = registros(900_000 + this.codigos.indexOf(hospital) * 1_000);
      this.porHospital.set(hospital, d);
    }
    return d;
  }

  private fontes(r: RegistroSintetico): FontesLidas {
    return {
      temConteudo: r.conteudo,
      temXml: r.xml,
      temDocumento: r.documento,
      situacoes: r.situacoes,
      tiposDocumento: r.documento ? [1] : [],
    };
  }

  private achar(c: ContextoProntuario, id: number): RegistroSintetico | undefined {
    return this.dados(c.hospital).find((r) => r.id === id);
  }

  async listar(
    c: ContextoProntuario,
    paciente: number,
    f: Parameters<PortaProntuario['listar']>[2],
    pagina: number,
    por: number,
  ) {
    const lista = this.dados(c.hospital)
      .filter((r) => r.paciente === paciente)
      .filter((r) => !f.de || r.dataHora.slice(0, 10) >= f.de)
      .filter((r) => !f.ate || r.dataHora.slice(0, 10) <= f.ate)
      .filter((r) => !f.modelo || r.modelo === f.modelo)
      .filter((r) => !f.profissional || r.profissional === f.profissional)
      .filter((r) => !f.cboIncluir?.length || f.cboIncluir.some((p) => (r.cbo ?? '').startsWith(p)))
      .filter((r) => !f.cboExcluir?.length || !f.cboExcluir.some((p) => (r.cbo ?? '').startsWith(p)))
      .sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1));
    const ini = (pagina - 1) * por;
    const pagina_ = lista.slice(ini, ini + por);
    return {
      registros: pagina_,
      haMais: lista.length > ini + por,
      fontes: new Map(pagina_.map((r) => [r.id, this.fontes(r)])),
    };
  }

  async resumo(c: ContextoProntuario, paciente: number) {
    const lista = this.dados(c.hospital).filter((r) => r.paciente === paciente);
    const modelos = [...new Set(lista.map((r) => r.modelo))].map((id) => ({
      id,
      codigo: NOMES_MODELO[id]?.codigo ?? null,
      nome: NOMES_MODELO[id]?.nome ?? null,
    }));
    const profissionais = [
      ...new Map(lista.map((r) => [r.profissional ?? 0, r.profissionalNome])).entries(),
    ].map(([id, nome]) => ({ id, nome }));
    return {
      modelos,
      profissionais,
      semConteudo: lista.filter((r) => !r.conteudo).length,
      dataImpossivel: 0,
    };
  }

  async excecoes(c: ContextoProntuario) {
    const grupos = new Map<string, ExcecaoAgregadaLida>();
    for (const r of this.dados(c.hospital).filter((x) => !x.conteudo)) {
      const mes = r.lancadoEm ? r.lancadoEm.slice(0, 7) : null;
      const k = `${r.modelo}|${mes}`;
      const g = grupos.get(k);
      grupos.set(k, {
        tipo: 'sem-conteudo',
        modelo: r.modelo,
        codigo: NOMES_MODELO[r.modelo]?.codigo ?? null,
        nome: NOMES_MODELO[r.modelo]?.nome ?? null,
        mes,
        registros: (g?.registros ?? 0) + 1,
      });
    }
    return [...grupos.values()];
  }

  async registro(c: ContextoProntuario, paciente: number, id: number) {
    const r = this.achar(c, id);
    return r && r.paciente === paciente ? { registro: r, fontes: this.fontes(r) } : null;
  }

  async conteudo(c: ContextoProntuario, id: number, partes: { rtf: boolean; xml: boolean }) {
    const r = this.achar(c, id);
    if (!r || !r.conteudo) return null;
    const campos = camposDe(r);
    const rtf = rtfSintetico([
      { texto: NOMES_MODELO[r.modelo]?.nome ?? M, negrito: true, centro: true },
      ...campos.filter((x) => x.valor).map((x) => ({ texto: `${x.titulo}: ${x.valor}` })),
    ]);
    return {
      rtf: partes.rtf ? rtf : null,
      xml: partes.xml && r.xml ? xmlFormulario(r.modelo, r.id, campos, false) : null,
      bytes: rtf.length,
    };
  }

  async eventosDocumento(c: ContextoProntuario, reg: Pick<RegistroProntuarioLido, 'id'>) {
    const r = this.achar(c, reg.id);
    if (!r || !r.documento) return [];
    return r.situacoes.map((s, i) => ({
      id: r.id * 10 + i,
      situacao: s,
      situacaoNome: s === 2 ? 'Suspenso' : 'Lançado',
      tipoDocumento: 1,
      em: s === 2 ? r.suspensoEm : r.dataHora,
      profissional: r.profissionalNome,
      temDocumento: s === 1,
    }));
  }

  async documentoXml(c: ContextoProntuario, idDocumento: number) {
    const r = this.achar(c, Math.floor(idDocumento / 10));
    if (!r || !r.documento) return null;
    return decodificarDocumentoEmitido(documentoComprimido(r, camposDe(r)));
  }

  async respostas(c: ContextoProntuario, id: number): Promise<RespostaLida[]> {
    const r = this.achar(c, id);
    if (!r || !r.conteudo) return [];
    return camposDe(r)
      .filter((x) => x.valor)
      .map((x) => ({
        ordem: x.ordem,
        seq: 0,
        idResposta: null,
        data: null,
        hora: null,
        indice: x.indice !== undefined ? String(x.indice) : null,
        valor: null,
        alfa: x.tipo === '11' ? x.valor : null,
        texto: x.tipo === '5' ? rtfSintetico([{ texto: x.valor }]) : null,
        unidade: null,
        cid: null,
        procedimento: null,
        observacao: null,
        autopreenchido: false,
      }));
  }

  async seloDoModelo(_c: ContextoProntuario, modelo: number) {
    return `${(CAMPOS[modelo] ?? []).length}.0.0.0.1`;
  }

  async representacaoGravada() {
    return null;
  }

  async definicaoModelo(_c: ContextoProntuario, modelo: number): Promise<DefinicaoFormularioLida | null> {
    const campos = CAMPOS[modelo];
    if (!campos) return null;
    const nome = NOMES_MODELO[modelo];
    return {
      modelo: { id: modelo, codigo: nome?.codigo ?? null, descricao: nome?.nome ?? null, fase: 2 },
      vinculos: campos.map((x, i) => ({
        id: modelo * 100 + i,
        idPergunta: modelo * 1000 + i,
        ordem: x.ordem,
        obrigatorio: 'F',
        ativo: 'T',
      })),
      perguntas: campos.map((x, i) => ({
        id: modelo * 1000 + i,
        codPergunta: i + 1,
        descricao: x.titulo,
        tipo: x.tipo,
        unidade: null,
        ativo: 'T',
        manterHist: null,
      })),
      respostas: campos.flatMap((x, i) =>
        (x.opcoes ?? []).map((o, j) => ({
          id: modelo * 10_000 + i * 10 + j,
          idPergunta: modelo * 1000 + i,
          cod: j,
          ordem: j + 1,
          ativo: true,
          descricao: o,
        })),
      ),
      componentes: campos.map((x, i) => ({
        id: modelo * 100 + i,
        idVinculo: modelo * 100 + i,
        classe: x.classe,
        pai: i === 0 ? 'jvsBox' : (campos[0]?.componente ?? 'jvsBox'),
        ordemCriacao: i,
        dfm: dfmDe(x),
      })),
      versoes: [{ versao: 1, componentes: campos.length }],
      colunasGrade: [],
      bytesDfm: 0,
    };
  }

  async contexto(c: ContextoProntuario, id: number) {
    const r = this.achar(c, id);
    if (!r) return null;
    return {
      pacienteNome: r.pacienteNome,
      pacienteNomeSocial: null,
      pacienteNascimento: '1980-02-03',
      atendimentoNumero: r.atendimento,
      entrada: `${r.dataHora.slice(0, 10)}T07:00:00.000`,
      unidade: `UNIDADE ${M}`,
      leito: 'BLOCO A 101A',
      convenio: `CONVENIO ${M}`,
      cidPrincipal: 'I20.0 ANGINA INSTÁVEL',
      cidSecundario: null,
      medicoAssistente: `ANA MÉDICA ${M}`,
      responsavelNome: `RESPONSÁVEL ${M}`,
      responsavelParentesco: 'FILHO',
      profissionalNome: r.profissionalNome,
      profissionalConselho: r.cbo?.startsWith('225') ? 'CRM 70001 RJ' : 'COREN 80002 RJ',
      cbo: r.cbo,
    };
  }

  async textos(c: ContextoProntuario, paciente: number, f: { de?: string; ate?: string }, teto: number) {
    const lista = (await this.listar(c, paciente, f, 1, 10_000)).registros;
    const registros = [];
    for (const r of lista.slice(0, teto)) {
      const x = await this.conteudo(c, r.id, { rtf: true, xml: false });
      registros.push({
        id: r.id,
        dataHora: r.dataHora,
        modelo: r.modeloCodigo,
        cbo: r.cbo,
        rtf: x?.rtf ?? null,
      });
    }
    return { registros, truncado: lista.length > teto };
  }

  async acessos(
    c: ContextoProntuario,
    f: Parameters<PortaProntuario['acessos']>[1],
    pagina: number,
    por: number,
  ) {
    const todos: AcessoLido[] = (this.trilha?.eventos ?? [])
      .filter(
        (e) =>
          e.hospital === c.hospital && (EVENTOS_LEITURA_PRONTUARIO as readonly string[]).includes(e.evento),
      )
      .filter((e) => !f.soAlertas || e.evento === EVENTO_ALERTA_LEITURA)
      .filter((e) => !f.paciente || e.paciente === f.paciente)
      .filter((e) => !f.usuario || e.usuario === f.usuario)
      .map((e) => ({
        id: e.id,
        em: e.em.replace('Z', ''),
        usuario: e.usuario,
        evento: e.evento,
        estacao: e.estacao,
        paciente: e.paciente ?? null,
        tabela: e.tabelaAlvo ?? null,
        alvo: e.idAlvo ?? null,
        chave: e.chaveNaturalAlvo ?? null,
        resultado: e.resultado,
        origem: e.como ? `SUPORTE:${e.como.atorTipo}` : null,
      }))
      .reverse();
    const ini = (pagina - 1) * por;
    return { itens: todos.slice(ini, ini + por), haMais: todos.length > ini + por };
  }
}
