// Regras do prontuário ao vivo na API (M15): monta a lista com as marcas legais e a fonte de cada registro,
// as cinco abas (como emitido, layout da época, texto formatado, respostas e contexto do ato), a busca de
// palavra e o registro de acesso. As regras puras vêm de @sgh/dominio-pep (leitor) e de @sgh/dominio-cadastro
// (categoria pelo CBO); os dados, da porta (legado ou memória). Nada aqui conhece tabela do legado.
// Cache curto, em memória do processo, com chave só de IDs (nunca nome): a representação do formulário por
// modelo e selo (10 min) e o conteúdo das abas por registro e pela assinatura do cabeçalho relido a cada
// abertura (60 s; o registro que mudou no SPDATA tem outra assinatura e é lido de novo).
import {
  type AbaRegistro,
  type AbaRegistroConteudo,
  type AcessoProntuario,
  type CabecalhoProntuario,
  type ComoEmitido,
  contagemAgregada,
  type ConsultaPalavra,
  type ContextoAto,
  type FiltrosAcessos,
  type FiltrosRegistros,
  type ItemResposta,
  lerChaveLeitura,
  type ListaAcessos,
  type ListaRegistros,
  type RegistroAberto,
  type RegistroResumo,
  type RelatorioExcecoes,
  type ResultadoPalavra,
  TETO_ACESSOS_PAGINA,
  TETO_BUSCA_PALAVRA,
  TETO_REGISTROS_PAGINA,
} from '@sgh/contratos';
import { categoriaPorCbo, prefixosDaCategoria } from '@sgh/dominio-cadastro';
import {
  AVISO_ILEGIVEL,
  AVISO_SEM_CONTEUDO,
  AVISO_SEM_DOCUMENTO,
  AVISO_SO_TEXTO,
  categoriaDoCbo,
  converterModelo,
  definicaoParaLeitura,
  fonteComoEmitido,
  lerDocumentoEmitido,
  lerLayoutEpoca,
  lerRespostas,
  marcarDivergencias,
  marcasDoRegistro,
  minutos,
  ocultarDocumentosDasRespostas,
  podeVerConteudo,
  procurarPalavra,
  representacaoParaLeitura,
  type RepresentacaoFormulario,
  type RespostaCadastrada,
  rtfParaTexto,
  TEXTO_SIGILO,
  textoCorrido,
  type VinculoDefinicao,
} from '@sgh/dominio-pep';
import type { CategoriaAssistencial } from '@sgh/contratos';
import type { FontesLidas, RegistroProntuarioLido } from './tipos-pep.js';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaCadastro } from '../cadastro/porta.js';
import type { ContextoProntuario, PortaProntuario } from './porta.js';

export const TTL_REPRESENTACAO_MS = 10 * 60_000;
export const TTL_ABA_MS = 60_000;
/** O relatório de exceções percorre todos os cabeçalhos do estabelecimento: 10 min de cache por estabelecimento. */
export const TTL_EXCECOES_MS = 10 * 60_000;
const TETO_CACHE = 500;

class CacheCurto<T> {
  private readonly m = new Map<string, { readonly ate: number; readonly valor: T }>();
  constructor(
    private readonly ttl: number,
    private readonly agora: () => number,
  ) {}
  async obter(chave: string, carregar: () => Promise<T>): Promise<T> {
    const x = this.m.get(chave);
    if (x && x.ate > this.agora()) return x.valor;
    const valor = await carregar();
    this.m.set(chave, { ate: this.agora() + this.ttl, valor });
    if (this.m.size > TETO_CACHE) {
      const primeira = this.m.keys().next().value;
      if (primeira !== undefined) this.m.delete(primeira);
    }
    return valor;
  }
  get tamanho(): number {
    return this.m.size;
  }
}

interface Modelo {
  readonly representacao: RepresentacaoFormulario | null;
  readonly origem: 'banco' | 'convertida' | 'ausente';
  readonly vinculos: VinculoDefinicao[];
  readonly respostas: Map<number, RespostaCadastrada>;
}

const NAO_ENCONTRADO = () => new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');

/** Erros do leitor (dado ilegível) viram aviso no registro, nunca 500 nem sumiço (regra 9). */
function ilegivel(e: unknown): boolean {
  return e instanceof Error && ['ErroXml', 'ErroRtf', 'ErroDocumento', 'ErroDfm'].includes(e.name);
}

export class ServicoProntuario {
  private readonly modelos: CacheCurto<Modelo>;
  private readonly abas: CacheCurto<AbaRegistroConteudo>;
  private readonly excecoesCache: CacheCurto<RelatorioExcecoes>;

  constructor(
    private readonly porta: PortaProntuario,
    private readonly cadastro: PortaCadastro,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.modelos = new CacheCurto(TTL_REPRESENTACAO_MS, () => this.agora().getTime());
    this.abas = new CacheCurto(TTL_ABA_MS, () => this.agora().getTime());
    this.excecoesCache = new CacheCurto(TTL_EXCECOES_MS, () => this.agora().getTime());
  }

  /**
   * Relatório agregado das exceções (regra 9), para o SAME e a comissão de prontuário: só contagens por tipo,
   * modelo e mês; de 1 a 4 vira "<5"; os totais trazem as parcelas na própria lista. Nenhum paciente.
   */
  excecoes(c: ContextoProntuario): Promise<RelatorioExcecoes> {
    return this.excecoesCache.obter(`${c.rede}:${c.hospital}`, async () => {
      const linhas = await this.porta.excecoes(c);
      const total = (t: string) => linhas.filter((x) => x.tipo === t).reduce((a, x) => a + x.registros, 0);
      return {
        estabelecimento: c.hospital,
        geradoEm: this.agora().toISOString(),
        linhas: [...linhas]
          .sort(
            (a, b) =>
              a.tipo.localeCompare(b.tipo) ||
              (b.mes ?? '').localeCompare(a.mes ?? '') ||
              (a.codigo ?? '').localeCompare(b.codigo ?? ''),
          )
          .map((x) => ({
            tipo: x.tipo,
            modelo: { id: x.modelo, codigo: x.codigo, nome: x.nome },
            mes: x.mes,
            registros: contagemAgregada(x.registros),
          })),
        totais: {
          'sem-conteudo': contagemAgregada(total('sem-conteudo')),
          'data-impossivel': contagemAgregada(total('data-impossivel')),
        },
      };
    });
  }

  get destino(): PortaProntuario['destino'] {
    return this.porta.destino;
  }

  async cabecalho(c: ContextoProntuario, paciente: number): Promise<CabecalhoProntuario> {
    const [p] = await this.cadastro.lerPacientes(c, [paciente]);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    return {
      paciente: p.id,
      prontuario: p.prontuario,
      nome: p.nome,
      nomeSocial: p.nomeSocial,
      nascimento: p.nascimento,
      sexo: p.sexo,
      obito: p.obito !== null,
      estabelecimento: c.hospital,
    };
  }

  resumo(r: RegistroProntuarioLido, f: FontesLidas): RegistroResumo {
    const marcas = marcasDoRegistro(
      {
        dataHora: r.dataHora,
        lancadoEm: r.lancadoEm,
        suspensoEm: r.suspensoEm,
        justificativaSuspensao: r.justificativaSuspensao,
        corrigeRegistro: r.corrigeRegistro,
        justificativaRetroativo: r.justificativaRetroativo,
        supervisor: r.supervisor,
        temConteudo: f.temConteudo,
        situacoesDocumento: f.situacoes,
        tiposDocumento: f.tiposDocumento,
      },
      this.agora(),
    );
    return {
      id: r.id,
      dataHora: marcas.dataImpossivel ? null : minutos(r.dataHora),
      lancadoEm: minutos(r.lancadoEm),
      modelo: { id: r.modelo, codigo: r.modeloCodigo, nome: r.modeloNome },
      profissional: {
        id: r.profissional,
        nome: r.profissionalNome,
        categoria: categoriaPorCbo(r.cbo),
        cbo: r.cbo,
      },
      atendimento: r.idHtAtendimento,
      fonteComoEmitido: fonteComoEmitido({
        documento: f.temDocumento,
        layout: f.temXml,
        texto: f.temConteudo,
      }),
      marcas,
    };
  }

  async lista(c: ContextoProntuario, paciente: number, f: FiltrosRegistros): Promise<ListaRegistros> {
    const cabecalho = await this.cabecalho(c, paciente);
    const cbo = f.categoria ? prefixosDaCategoria(f.categoria) : null;
    const [pagina, resumo] = await Promise.all([
      this.porta.listar(
        c,
        paciente,
        {
          ...(f.de ? { de: f.de } : {}),
          ...(f.ate ? { ate: f.ate } : {}),
          ...(f.modelo ? { modelo: f.modelo } : {}),
          ...(f.profissional ? { profissional: f.profissional } : {}),
          ...(cbo ? { cboIncluir: cbo.incluir, cboExcluir: cbo.excluir } : {}),
        },
        f.pagina,
        TETO_REGISTROS_PAGINA,
      ),
      this.porta.resumo(c, paciente),
    ]);
    return {
      cabecalho,
      itens: pagina.registros.map((r) =>
        this.resumo(
          r,
          pagina.fontes.get(r.id) ?? {
            temConteudo: false,
            temXml: false,
            temDocumento: false,
            situacoes: [],
            tiposDocumento: [],
          },
        ),
      ),
      pagina: f.pagina,
      porPagina: TETO_REGISTROS_PAGINA,
      haMais: pagina.haMais,
      modelos: resumo.modelos,
      profissionais: resumo.profissionais,
      excecoes: { semConteudo: resumo.semConteudo, dataImpossivel: resumo.dataImpossivel },
    };
  }

  private async registroDoPaciente(c: ContextoProntuario, paciente: number, id: number) {
    const x = await this.porta.registro(c, paciente, id);
    if (!x) throw NAO_ENCONTRADO();
    return x;
  }

  /**
   * M23 (regra 15): abre o registro. No registro de categoria sigilosa (psicologia) lido por outra categoria, só a data,
   * o profissional e a categoria: as abas ficam indisponíveis com o aviso do sigilo.
   */
  async abrir(
    c: ContextoProntuario,
    paciente: number,
    id: number,
    leitor: CategoriaAssistencial | null = null,
  ): Promise<RegistroAberto> {
    const [cabecalho, x] = await Promise.all([
      this.cabecalho(c, paciente),
      this.registroDoPaciente(c, paciente, id),
    ]);
    const r = this.resumo(x.registro, x.fontes);
    const sem = (motivo: string) => ({ disponivel: false, motivo });
    const sim = { disponivel: true, motivo: null };
    if (!podeVerConteudo(categoriaDoCbo(x.registro.cbo), leitor))
      return {
        cabecalho,
        registro: r,
        abas: {
          'como-emitido': sem(TEXTO_SIGILO),
          layout: sem(TEXTO_SIGILO),
          texto: sem(TEXTO_SIGILO),
          respostas: sem(TEXTO_SIGILO),
          contexto: sem(TEXTO_SIGILO),
        },
      };
    return {
      cabecalho,
      registro: r,
      abas: {
        'como-emitido': r.fonteComoEmitido === 'nenhuma' ? sem(AVISO_SEM_CONTEUDO) : sim,
        layout: x.fontes.temXml ? sim : sem('Este registro não tem o formulário gravado.'),
        texto: x.fontes.temConteudo ? sim : sem(AVISO_SEM_CONTEUDO),
        respostas: sim,
        contexto: sim,
      },
    };
  }

  /** O conteúdo de uma aba; o cabeçalho é relido a cada abertura (a assinatura entra na chave do cache). */
  async aba(
    c: ContextoProntuario,
    paciente: number,
    id: number,
    aba: AbaRegistro,
    opcoes: { readonly mostrarDocumentos: boolean; readonly leitor?: CategoriaAssistencial | null },
  ): Promise<AbaRegistroConteudo> {
    const x = await this.registroDoPaciente(c, paciente, id);
    // M23 (regra 15): o conteúdo do registro sigiloso fica só com a categoria que o registrou.
    if (!podeVerConteudo(categoriaDoCbo(x.registro.cbo), opcoes.leitor ?? null))
      throw new ErroProblema('sem-permissao', 403, 'Conteúdo restrito', TEXTO_SIGILO);
    const assinatura = JSON.stringify([x.registro, x.fontes]);
    const chave = `${c.hospital}:${id}:${aba}:${opcoes.mostrarDocumentos ? 1 : 0}:${hash(assinatura)}`;
    return this.abas.obter(chave, () => this.carregarAba(c, x.registro, x.fontes, aba, opcoes));
  }

  private async carregarAba(
    c: ContextoProntuario,
    r: RegistroProntuarioLido,
    f: FontesLidas,
    aba: AbaRegistro,
    opcoes: { readonly mostrarDocumentos: boolean },
  ): Promise<AbaRegistroConteudo> {
    switch (aba) {
      case 'como-emitido':
        return { aba, conteudo: await this.comoEmitido(c, r, f, opcoes) };
      case 'layout': {
        const conteudo = f.temXml ? await this.porta.conteudo(c, r.id, { rtf: false, xml: true }) : null;
        if (!conteudo?.xml) return { aba, conteudo: { modelo: r.modelo, composicao: null, campos: [] } };
        try {
          return { aba, conteudo: lerLayoutEpoca(conteudo.xml, opcoes) };
        } catch (e) {
          if (!ilegivel(e)) throw e;
          return { aba, conteudo: { modelo: r.modelo, composicao: AVISO_ILEGIVEL, campos: [] } };
        }
      }
      case 'texto': {
        const conteudo = f.temConteudo ? await this.porta.conteudo(c, r.id, { rtf: true, xml: false }) : null;
        try {
          return { aba, conteudo: { ...rtfParaTexto(conteudo?.rtf ?? ''), aviso: null } };
        } catch (e) {
          if (!ilegivel(e)) throw e;
          // Regra 9: o texto ilegível aparece como aviso, não como "sem texto".
          return {
            aba,
            conteudo: {
              paragrafos: [],
              cores: [],
              ignorados: {},
              conteudoAtivoRemovido: 0,
              aviso: AVISO_ILEGIVEL,
            },
          };
        }
      }
      case 'respostas':
        return { aba, conteudo: await this.respostas(c, r, f, opcoes) };
      case 'contexto':
        return { aba, conteudo: await this.contexto(c, r) };
    }
  }

  private async comoEmitido(
    c: ContextoProntuario,
    r: RegistroProntuarioLido,
    f: FontesLidas,
    opcoes: { readonly mostrarDocumentos: boolean },
  ): Promise<ComoEmitido> {
    const fonte = fonteComoEmitido({ documento: f.temDocumento, layout: f.temXml, texto: f.temConteudo });
    const eventos = f.temDocumento || f.situacoes.length > 0 ? await this.porta.eventosDocumento(c, r) : [];
    const eventosTela = eventos.map((e) => ({
      situacao: e.situacaoNome ?? `situação ${e.situacao}`,
      em: minutos(e.em),
      profissional: e.profissional,
    }));
    let aviso: string | null = null;
    if (fonte === 'documento') {
      const doc =
        eventos.find((e) => e.temDocumento && e.situacao === 1) ?? eventos.find((e) => e.temDocumento);
      try {
        const xml = doc ? await this.porta.documentoXml(c, doc.id) : null;
        if (xml) {
          const d = lerDocumentoEmitido(xml, opcoes);
          return {
            fonte,
            blocos: d.blocos,
            campos: d.campos,
            eventos: eventosTela,
            texto: null,
            aviso: null,
          };
        }
      } catch (e) {
        if (!ilegivel(e)) throw e;
        aviso = AVISO_ILEGIVEL;
      }
    }
    if (f.temXml) {
      const ctx = await this.contexto(c, r);
      const blocos = blocosDoContexto(ctx);
      try {
        const conteudo = await this.porta.conteudo(c, r.id, { rtf: false, xml: true });
        if (conteudo?.xml) {
          const l = lerLayoutEpoca(conteudo.xml, opcoes);
          return {
            fonte: 'layout',
            blocos,
            campos: l.campos,
            eventos: eventosTela,
            texto: null,
            aviso: aviso ?? AVISO_SEM_DOCUMENTO,
          };
        }
      } catch (e) {
        if (!ilegivel(e)) throw e;
        aviso = AVISO_ILEGIVEL;
      }
    }
    if (f.temConteudo) {
      const conteudo = await this.porta.conteudo(c, r.id, { rtf: true, xml: false });
      try {
        return {
          fonte: 'texto',
          blocos: [],
          campos: [],
          eventos: eventosTela,
          texto: rtfParaTexto(conteudo?.rtf ?? ''),
          aviso: aviso ?? AVISO_SO_TEXTO,
        };
      } catch (e) {
        if (!ilegivel(e)) throw e;
        aviso = AVISO_ILEGIVEL;
      }
    }
    return {
      fonte: 'nenhuma',
      blocos: [],
      campos: [],
      eventos: eventosTela,
      texto: null,
      aviso: aviso ?? AVISO_SEM_CONTEUDO,
    };
  }

  /** Representação do modelo pelo selo (banco, se o worker já gravou; senão a conversão na hora). */
  private modelo(c: ContextoProntuario, modelo: number): Promise<Modelo> {
    return this.porta.seloDoModelo(c, modelo).then((selo) =>
      this.modelos.obter(`${c.rede}:${c.hospital}:${modelo}:${selo}`, async () => {
        const gravada = await this.porta.representacaoGravada(c, modelo, selo);
        if (gravada) {
          const rep = gravada.representacao as RepresentacaoFormulario;
          return { representacao: rep, origem: 'banco', ...representacaoParaLeitura(rep) };
        }
        const def = await this.porta.definicaoModelo(c, modelo);
        if (!def) return { representacao: null, origem: 'ausente', vinculos: [], respostas: new Map() };
        const rep = await converterModelo(def);
        return { representacao: rep, origem: 'convertida', ...definicaoParaLeitura(def) };
      }),
    );
  }

  async representacaoDoModelo(
    c: ContextoProntuario,
    modelo: number,
  ): Promise<RepresentacaoFormulario | null> {
    return (await this.modelo(c, modelo)).representacao;
  }

  private async respostas(
    c: ContextoProntuario,
    r: RegistroProntuarioLido,
    f: FontesLidas,
    opcoes: { readonly mostrarDocumentos: boolean },
  ) {
    const [linhas, m, conteudo] = await Promise.all([
      this.porta.respostas(c, r.id),
      this.modelo(c, r.modelo),
      f.temXml ? this.porta.conteudo(c, r.id, { rtf: false, xml: true }) : Promise.resolve(null),
    ]);
    const lidas = lerRespostas({
      linhas,
      vinculos: m.vinculos,
      respostas: m.respostas,
      representacao: m.representacao,
    });
    // DP-28: onde a resposta difere do formulário gravado com o registro, "a confirmar" (a referência é o
    // como emitido). Formulário ilegível: sem a marcação (o aviso aparece nas outras abas).
    let itens: readonly ItemResposta[] = lidas.itens;
    if (conteudo?.xml) {
      try {
        itens = marcarDivergencias(lidas.itens, lerLayoutEpoca(conteudo.xml).campos).itens;
      } catch (e) {
        if (!ilegivel(e)) throw e;
      }
    }
    // D-DOC-1: a divergência é medida sobre os valores inteiros; só a saída é mascarada sem a permissão.
    if (!opcoes.mostrarDocumentos) itens = ocultarDocumentosDasRespostas(itens);
    const contar = (l: readonly ItemResposta[]): number =>
      l.reduce(
        (a, i) =>
          a +
          (i.aConfirmar && i.valores.length + (i.grade?.linhas.length ?? 0) > 0 ? 1 : 0) +
          contar(i.itens),
        0,
      );
    return {
      itens: [...itens],
      total: lidas.total,
      aConfirmar: contar(itens),
      representacao: { impressao: m.representacao?.impressaoLayout.slice(0, 12) ?? null, origem: m.origem },
    };
  }

  private async contexto(c: ContextoProntuario, r: RegistroProntuarioLido): Promise<ContextoAto> {
    const x = await this.porta.contexto(c, r.id);
    return {
      paciente: {
        nome: x?.pacienteNome ?? null,
        nomeSocial: x?.pacienteNomeSocial ?? null,
        nascimento: x?.pacienteNascimento ?? null,
      },
      atendimento: {
        numero: x?.atendimentoNumero ?? null,
        entrada: minutos(x?.entrada ?? null),
        unidade: x?.unidade ?? null,
        leito: x?.leito ?? null,
        convenio: x?.convenio ?? null,
        cidPrincipal: x?.cidPrincipal ?? null,
        cidSecundario: x?.cidSecundario ?? null,
        medicoAssistente: x?.medicoAssistente ?? null,
      },
      responsavel:
        x?.responsavelNome || x?.responsavelParentesco
          ? { nome: x.responsavelNome, parentesco: x.responsavelParentesco }
          : null,
      profissional: {
        nome: x?.profissionalNome ?? null,
        conselho: x?.profissionalConselho ?? null,
        cbo: x?.cbo ?? null,
      },
    };
  }

  /** Busca de palavra; o registro sigiloso para o leitor (regra 15 do M23) fica fora dos resultados. */
  async buscar(
    c: ContextoProntuario,
    paciente: number,
    q: ConsultaPalavra,
    leitor: CategoriaAssistencial | null = null,
  ): Promise<ResultadoPalavra> {
    await this.cabecalho(c, paciente);
    const t = await this.porta.textos(
      c,
      paciente,
      { ...(q.de ? { de: q.de } : {}), ...(q.ate ? { ate: q.ate } : {}) },
      TETO_BUSCA_PALAVRA,
    );
    const itens: ResultadoPalavra['itens'] = [];
    for (const r of t.registros) {
      if (!r.rtf) continue;
      if (!podeVerConteudo(categoriaDoCbo(r.cbo), leitor)) continue;
      let texto: string;
      try {
        texto = textoCorrido(rtfParaTexto(r.rtf));
      } catch (e) {
        if (!ilegivel(e)) throw e;
        continue;
      }
      const o = procurarPalavra(texto, q.termo);
      if (o.ocorrencias > 0)
        itens.push({
          registro: r.id,
          dataHora: minutos(r.dataHora),
          modelo: r.modelo,
          ocorrencias: o.ocorrencias,
          trecho: o.trecho,
        });
    }
    return { itens, lidos: t.registros.length, truncado: t.truncado };
  }

  async acessos(c: ContextoProntuario, f: FiltrosAcessos): Promise<ListaAcessos> {
    const r = await this.porta.acessos(
      c,
      {
        ...(f.paciente ? { paciente: f.paciente } : {}),
        ...(f.usuario ? { usuario: f.usuario } : {}),
        ...(f.de ? { de: f.de } : {}),
        ...(f.ate ? { ate: f.ate } : {}),
        ...(f.soAlertas === 'sim' ? { soAlertas: true } : {}),
      },
      f.pagina,
      TETO_ACESSOS_PAGINA,
    );
    return {
      itens: r.itens.map((a): AcessoProntuario => {
        const { parte, motivo } = lerChaveLeitura(a.chave);
        return {
          id: a.id,
          em: a.em ?? '',
          usuario: a.usuario,
          estacao: a.estacao,
          paciente: a.paciente,
          registro:
            a.tabela === 'registro_assistencial' && /^\d+$/.test(a.alvo ?? '') ? Number(a.alvo) : null,
          parte: parte ?? rotuloEvento(a.evento),
          motivo,
          resultado: a.resultado,
          origem: a.origem,
          alerta: alertaDaChave(a.evento, a.chave),
        };
      }),
      pagina: f.pagina,
      porPagina: TETO_ACESSOS_PAGINA,
      haMais: r.haMais,
    };
  }
}

function rotuloEvento(evento: string): string | null {
  if (evento === 'acesso.emergencia.aberta') return 'emergencia';
  if (evento === 'pep.motivo.informado') return 'motivo';
  if (evento === 'auditoria.leitura.alertada') return 'alerta';
  return null;
}

/** O alerta ao Auditor gravado na trilha (`alerta:<tipo>;crit:<n>`); null nas leituras. */
export function alertaDaChave(evento: string, chave: string | null): AcessoProntuario['alerta'] {
  if (evento !== 'auditoria.leitura.alertada') return null;
  const m = /^alerta:(muitos-prontuarios|fora-do-horario);crit:(\d+)/.exec(chave ?? '');
  return m ? { tipo: m[1] as 'muitos-prontuarios' | 'fora-do-horario', criticidade: Number(m[2]) } : null;
}

function blocosDoContexto(x: ContextoAto): ComoEmitido['blocos'] {
  const campos = (pares: readonly (readonly [string, string | number | null])[]) =>
    pares.filter(([, v]) => v !== null && v !== '').map(([rotulo, v]) => ({ rotulo, valor: String(v) }));
  const data = (v: string | null) =>
    v
      ? v.replace(
          /^(\d{4})-(\d{2})-(\d{2})T?(\d{2}:\d{2})?.*$/,
          (_m, a, b, d, h) => `${d}/${b}/${a}${h ? ` ${h}` : ''}`,
        )
      : null;
  return [
    {
      titulo: 'Paciente (no momento do ato)',
      campos: campos([
        ['Nome', x.paciente.nomeSocial ?? x.paciente.nome],
        ['Nascimento', data(x.paciente.nascimento)],
      ]),
    },
    {
      titulo: 'Atendimento',
      campos: campos([
        ['Atendimento', x.atendimento.numero],
        ['Entrada', data(x.atendimento.entrada)],
        ['Unidade', x.atendimento.unidade],
        ['Leito', x.atendimento.leito],
        ['Convênio', x.atendimento.convenio],
        ['CID principal', x.atendimento.cidPrincipal],
        ['Médico assistente', x.atendimento.medicoAssistente],
      ]),
    },
    {
      titulo: 'Profissional',
      campos: campos([
        ['Nome', x.profissional.nome],
        ['Conselho', x.profissional.conselho],
      ]),
    },
  ].filter((b) => b.campos.length > 0);
}

/** Hash curto (FNV-1a) da assinatura do cabeçalho: chave de cache sem conteúdo. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** CSV do registro de acesso (sem dado clínico; o separador é ";" como as planilhas do Brasil esperam). */
export function csvAcessos(l: ListaAcessos): string {
  const cel = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    // Fórmula de planilha neutralizada (=, +, -, @ no início).
    const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  const linhas = [
    [
      'em',
      'usuario',
      'estacao',
      'paciente',
      'registro',
      'parte',
      'motivo',
      'resultado',
      'origem',
      'alerta',
    ].join(';'),
  ];
  for (const a of l.itens)
    linhas.push(
      [
        a.em,
        a.usuario,
        a.estacao,
        a.paciente,
        a.registro,
        a.parte,
        a.motivo,
        a.resultado,
        a.origem,
        a.alerta ? `${a.alerta.tipo}:${a.alerta.criticidade}` : null,
      ]
        .map(cel)
        .join(';'),
    );
  return `${linhas.join('\r\n')}\r\n`;
}
