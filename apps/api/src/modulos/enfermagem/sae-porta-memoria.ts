// Porta da etapa 4 do M45 EM MEMÓRIA: a sessão sintética de dev/ci (E2E). Os internados, o relógio e os vínculos vêm da
// porta da enfermagem em memória; os domínios da escala e das metas são os da cópia `pc` (1 a 5 e NA; aumentar para,
// manter em, diminuir para); a consulta de enfermagem é um atendimento externo SINTÉTICO do enfermeiro do plantão (e um
// do médico, para a recusa); o processo, as atividades, as checagens, a terminologia carregada, as receitas e as vacinas
// ficam em memória, com as mesmas recusas da gravação SGH_ (a versão vista, o processo vigente, a suspensão e o
// estorno uma vez só, o horário uma vez por geração, a versão da terminologia, a dose uma vez só, a chave reutilizada).
// Nada é de pessoa real (marca "SINTETICO M45").
import type { ChecagemCuidadoLida } from '@sgh/contratos';
import { type ContextoOperacao, recusa } from '@sgh/nucleo';
import {
  comporTerminologiaSae,
  doseVigenteDaVacina,
  edicoesVigentesSae,
  montarEdicaoTerminologia,
} from '@sgh/dominio-enfermagem';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import {
  type ConsultaDeEnfermagem,
  type AtividadeVigente,
  type CorrecaoVacina,
  EVENTO_VACINA_CANCELADA,
  EVENTO_VACINA_SUBSTITUIDA,
  type ItemSae,
  type ReceitaDoEnfermeiro,
  type TermoTerminologiaSae,
  type VacinaAplicada,
  type RecusaEnvioVacina,
} from './sae-tipos.js';
import type { ContextoSae, GravadorSae, PortaSae } from './sae-porta.js';
import { chaveDoEstabelecimento } from './tipos-vinculados.js';
import type { PortaEnfermagem } from './porta.js';

const M = 'SINTETICO M45';
/** A consulta de enfermagem sintética (atendimento externo do enfermeiro do plantão) e a do médico. */
export const CONSULTA_ENFERMAGEM_SINTETICA = 45_401;
export const CONSULTA_MEDICA_SINTETICA = 45_411;
const PACIENTE_CONSULTA = 45_402;
/** O vínculo sintético do enfermeiro do plantão (o da porta da enfermagem em memória). */
const VINCULO_ENFERMEIRO = 92_501;

interface Sae {
  id: number;
  atendimento: number;
  paciente: number;
  versao: number;
  sistema: 'SINT' | 'NNN' | 'CIPE';
  versaoTerminologia: string;
  avaliacao: string;
  usuario: string;
  em: string;
  chave: string | null;
}
type Item = ItemSae & { sae: number; atendimento: number; paciente: number };
interface Checagem {
  id: number;
  item: number;
  atendimento: number;
  tipo: 'checagem' | 'estorno';
  previsto: string;
  feita: boolean;
  motivo: string | null;
  horaReal: string;
  origemOffline: boolean;
  chaveHorario: string | null;
  estornado: number | null;
  categoria: 'enfermeiro' | 'tecnico';
  usuario: string;
  em: string;
  chave: string | null;
}
type Mutavel<T> = { -readonly [K in keyof T]: T[K] };

interface Estado {
  seq: number;
  saes: Sae[];
  itens: Item[];
  checagens: Checagem[];
  termos: (TermoTerminologiaSae & { id: number })[];
  receitas: (Mutavel<ReceitaDoEnfermeiro> & {
    atendimento: number;
    paciente: number;
    chave: string | null;
  })[];
  vacinas: (Omit<VacinaAplicada, 'correcoes'> & {
    correcoes: CorrecaoVacina[];
    paciente: number;
    chaveDose: string | null;
    chave: string | null;
  })[];
  /** W0-03: a fila de saída (SGH_OUTBOX) da memória: o tipo, a chave e a carga (só IDs). */
  fila: { id: string; tipo: string; chave: string; carga: Record<string, number> }[];
  /** W0-03 (M6, testes): as recusas do RIA simuladas (na memória não há conector). */
  recusas: RecusaEnvioVacina[];
}

/** Revisão W0-03: a dose vigente na memória é a mesma regra da leitura do banco. */
const doseVigente = doseVigenteDaVacina;

export class PortaSaeMemoria implements PortaSae {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly enfermagem: PortaEnfermagem) {}

  private e(c: ContextoSae): Estado {
    let s = this.estados.get(chaveDoEstabelecimento(c));
    if (!s) {
      s = {
        seq: 45_700,
        saes: [],
        itens: [],
        checagens: [],
        termos: [],
        receitas: [],
        vacinas: [],
        fila: [],
        recusas: [],
      };
      this.estados.set(chaveDoEstabelecimento(c), s);
    }
    return s;
  }

  private async agora(c: ContextoSae): Promise<string> {
    return (await this.enfermagem.relogio(c)).slice(0, 19);
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(c: ContextoSae, op: string, e: unknown, x: ContextoOperacao): never {
    void [c, e, x];
    throw new Error(`Operação ${op} sem simulação em memória: a etapa grava só no novo.`);
  }

  async gravarSgh<T>(c: ContextoSae, _trilha: unknown, fn: (g: GravadorSae) => Promise<T>): Promise<T> {
    const s = this.e(c);
    const agora = await this.agora(c);
    const k = (chave: string | null, sufixo = '') =>
      chave ? `${chaveDoEstabelecimento(c)}:${chave}${sufixo}` : null;
    const vigente = (atendimento: number) =>
      s.saes.filter((x) => x.atendimento === atendimento).sort((a, b) => b.versao - a.versao)[0] ?? null;
    const SAE_MUDOU = () =>
      recusa(
        'sae-mudou',
        'O processo de enfermagem deste paciente mudou depois da leitura (outra versão foi registrada): confira e registre de novo.',
      );
    const item = (
      b: { sae: number; atendimento: number; paciente: number; usuario: string },
      x: Partial<Item>,
    ): Item => {
      const it: Item = {
        id: ++s.seq,
        tipo: 'diagnostico',
        pai: null,
        codigo: null,
        descricao: '',
        caracteristicas: [],
        fatores: [],
        escala: null,
        meta: null,
        escalaMeta: null,
        frequencia: null,
        horarios: [],
        inicio: null,
        fim: null,
        situacao: null,
        nota: null,
        chave: null,
        em: agora,
        ...b,
        ...x,
      };
      s.itens.push(it);
      return it;
    };
    const jaPelaChave = (chave: string, atendimento: number) => {
      const ja = s.itens.filter((x) => x.chave?.startsWith(`${chaveDoEstabelecimento(c)}:${chave}#`));
      if (ja.length === 0) return null;
      if (ja.some((x) => x.atendimento !== atendimento))
        throw recusa(
          'chave-reutilizada',
          'A chave deste pedido já foi usada em outro registro: refaça na tela.',
        );
      return ja.map((x) => x.id);
    };
    const g: GravadorSae = {
      registrarSae: async (p) => {
        const ch = k(p.chave);
        const ja = ch ? s.saes.find((x) => x.chave === ch) : undefined;
        if (ja) {
          if (ja.atendimento !== p.atendimento || ja.usuario !== p.usuario)
            throw recusa(
              'chave-reutilizada',
              'A chave deste pedido já foi usada em outro registro: refaça na tela.',
            );
          return { id: ja.id, versao: ja.versao, itens: 0, repetida: true };
        }
        const v = vigente(p.atendimento);
        if ((v?.versao ?? 0) !== p.versaoVista) throw SAE_MUDOU();
        const sae: Sae = {
          id: ++s.seq,
          atendimento: p.atendimento,
          paciente: p.paciente,
          versao: (v?.versao ?? 0) + 1,
          sistema: p.sistema,
          versaoTerminologia: p.versaoTerminologia,
          avaliacao: p.avaliacao,
          usuario: p.usuario,
          em: agora,
          chave: ch,
        };
        s.saes.push(sae);
        const b = { sae: sae.id, atendimento: p.atendimento, paciente: p.paciente, usuario: p.usuario };
        let n = 0;
        for (const d of p.diagnosticos) {
          const di = item(b, {
            tipo: 'diagnostico',
            codigo: d.codigo,
            descricao: d.descricao,
            caracteristicas: [...d.caracteristicas],
            fatores: [...d.fatores],
          });
          n++;
          for (const r of d.resultados) {
            item(b, {
              tipo: 'resultado',
              pai: di.id,
              codigo: r.codigo,
              descricao: r.descricao,
              escala: r.escalaAtual,
              meta: r.meta,
              escalaMeta: r.escalaMeta,
            });
            n++;
          }
          for (const iv of d.intervencoes) {
            item(b, { tipo: 'intervencao', pai: di.id, codigo: iv.codigo, descricao: iv.descricao });
            n++;
          }
        }
        return { id: sae.id, versao: sae.versao, itens: n, repetida: false };
      },
      evoluir: async (x) => {
        const ja = jaPelaChave(x.chave, x.atendimento);
        if (ja) return { ids: ja, repetida: true };
        if (vigente(x.atendimento)?.id !== x.sae) throw SAE_MUDOU();
        const deles = new Set(
          s.itens.filter((i) => i.sae === x.sae && i.tipo === 'resultado').map((i) => i.id),
        );
        if (x.resultados.some((r) => !deles.has(r.resultado)))
          throw recusa('resultado-de-outro-processo', 'O resultado não é do processo vigente.');
        const b = { sae: x.sae, atendimento: x.atendimento, paciente: x.paciente, usuario: x.usuario };
        return {
          ids: x.resultados.map(
            (r, i) =>
              item(b, {
                tipo: 'evolucao',
                pai: r.resultado,
                descricao: r.descricao,
                escala: r.escala,
                situacao: r.situacao,
                nota: x.nota,
                chave: k(x.chave, `#${i}`),
              }).id,
          ),
          repetida: false,
        };
      },
      prescrever: async (x) => {
        const ja = jaPelaChave(x.chave, x.atendimento);
        if (ja) return { ids: ja, repetida: true };
        if (vigente(x.atendimento)?.id !== x.sae) throw SAE_MUDOU();
        const deles = new Set(
          s.itens.filter((i) => i.sae === x.sae && i.tipo === 'intervencao').map((i) => i.id),
        );
        if (x.atividades.some((a) => !deles.has(a.intervencao)))
          throw recusa('intervencao-de-outro-processo', 'A intervenção não é do processo vigente.');
        const b = { sae: x.sae, atendimento: x.atendimento, paciente: x.paciente, usuario: x.usuario };
        return {
          ids: x.atividades.map(
            (a, i) =>
              item(b, {
                tipo: 'atividade',
                pai: a.intervencao,
                codigo: a.codigo,
                descricao: a.descricao,
                frequencia: a.frequenciaDia,
                horarios: [...a.horarios],
                inicio: a.inicio,
                fim: a.fim,
                chave: k(x.chave, `#${i}`),
              }).id,
          ),
          repetida: false,
        };
      },
      suspender: async (x) => {
        const a = s.itens.find((i) => i.id === x.atividade && i.tipo === 'atividade');
        if (!a || a.atendimento !== x.atendimento)
          throw recusa('nao-encontrado', 'Atividade não encontrada neste atendimento.');
        if (s.itens.some((i) => i.tipo === 'suspensao' && i.pai === a.id))
          throw recusa('ja-suspensa', 'Esta atividade já foi suspensa.');
        return item(
          { sae: a.sae, atendimento: a.atendimento, paciente: a.paciente, usuario: x.usuario },
          { tipo: 'suspensao', pai: a.id, descricao: 'Suspensão da atividade', nota: x.motivo },
        ).id;
      },
      checar: async (x) => {
        const ch = k(x.chave);
        const ja = ch ? s.checagens.find((y) => y.chave === ch) : undefined;
        if (ja) {
          if (ja.item !== x.atividade)
            throw recusa(
              'chave-reutilizada',
              'A chave deste ato já foi usada em outra checagem: refaça na tela.',
            );
          return { id: ja.id, repetida: true };
        }
        const a = s.itens.find((i) => i.id === x.atividade && i.tipo === 'atividade');
        if (!a || a.atendimento !== x.atendimento)
          throw recusa('nao-encontrado', 'Atividade não encontrada neste atendimento.');
        if (s.itens.some((i) => i.tipo === 'suspensao' && i.pai === a.id))
          throw recusa('atividade-suspensa', 'A atividade foi suspensa: nada foi checado.');
        const previsto = x.previsto.slice(0, 16);
        const geracao = s.checagens.filter(
          (y) => y.item === a.id && y.tipo === 'estorno' && y.previsto === previsto,
        ).length;
        const chaveHorario = `${chaveDoEstabelecimento(c)}:${a.id}:${previsto.replace(/\D/g, '')}:${geracao}`;
        if (s.checagens.some((y) => y.chaveHorario === chaveHorario))
          throw recusa(
            'ja-checado',
            'Este horário já foi checado: para corrigir, estorne a checagem com a justificativa.',
          );
        const id = ++s.seq;
        s.checagens.push({
          id,
          item: a.id,
          atendimento: a.atendimento,
          tipo: 'checagem',
          previsto,
          feita: x.feita,
          motivo: x.motivo,
          horaReal: x.horaReal.slice(0, 16),
          origemOffline: x.origemOffline,
          chaveHorario,
          estornado: null,
          categoria: x.categoria,
          usuario: x.usuario,
          em: agora,
          chave: ch,
        });
        return { id, repetida: false };
      },
      estornar: async (x) => {
        const o = s.checagens.find((y) => y.id === x.checagem && y.tipo === 'checagem');
        if (!o || o.atendimento !== x.atendimento)
          throw recusa('nao-encontrado', 'Checagem não encontrada neste atendimento.');
        if (s.checagens.some((y) => y.estornado === o.id))
          throw recusa('ja-estornado', 'Esta checagem já foi estornada.');
        const id = ++s.seq;
        s.checagens.push({
          ...o,
          id,
          tipo: 'estorno',
          feita: false,
          motivo: x.motivo,
          horaReal: agora.slice(0, 16),
          origemOffline: false,
          chaveHorario: null,
          estornado: o.id,
          categoria: x.categoria,
          usuario: x.usuario,
          em: agora,
          chave: null,
        });
        return id;
      },
      carregarTerminologia: async (t) => {
        // A mesma regra da porta própria: o termo é único por sistema + código + edição (montarEdicaoTerminologia).
        const m = montarEdicaoTerminologia({ pacote: t.sistema, termos: t.termos });
        if (!m.ok) throw recusa(m.codigo, m.mensagem);
        if (s.termos.some((x) => x.sistema === t.sistema && x.versao === t.versao))
          throw recusa(
            'versao-ja-carregada',
            'Esta versão da terminologia já foi carregada (a versão carregada é imutável).',
          );
        for (const x of t.termos)
          s.termos.push({ id: ++s.seq, sistema: t.sistema, versao: t.versao, licenca: t.licenca, ...x });
        return { termos: t.termos.length };
      },
      prescreverMedicamento: async (r) => {
        const ch = k(r.chave);
        const ja = ch ? s.receitas.find((x) => x.chave === ch) : undefined;
        if (ja) {
          if (ja.atendimento !== r.atendimento)
            throw recusa(
              'chave-reutilizada',
              'A chave deste pedido já foi usada em outra receita: refaça na tela.',
            );
          return { id: ja.id, repetida: true };
        }
        const id = ++s.seq;
        s.receitas.unshift({
          id,
          atendimento: r.atendimento,
          paciente: r.paciente,
          protocolo: r.protocolo,
          ano: r.ano,
          tipoProtocolo: r.tipoProtocolo,
          modelo: r.modelo,
          listaVersao: r.listaVersao,
          segundoIdentificador: r.segundoIdentificador,
          coren: r.coren,
          categoria: r.categoria,
          itens: [...r.itens],
          impressao: r.impressao,
          assinadaEm: r.assinadaEm.slice(0, 16),
          vinculo: r.vinculo,
          usuario: r.usuario,
          chave: ch,
          anterior: r.anterior ?? null,
          reemitidaEm: null,
          inativacao: null,
        });
        if (r.anterior) {
          const a = s.receitas.find((x) => x.id === r.anterior)!;
          a.reemitidaEm = id;
        }
        return { id, repetida: false };
      },
      inativarReceita: async (r) => {
        const x = s.receitas.find((y) => y.id === r.id && y.atendimento === r.atendimento);
        if (!x) throw recusa('receita-inexistente', 'A receita não foi encontrada neste atendimento.');
        if (x.inativacao) throw recusa('receita-ja-inativa', 'A receita já foi suspensa ou cancelada.');
        x.inativacao = { tipo: r.tipo, motivo: r.motivo, usuario: r.usuario, em: agora.slice(0, 16) };
        return { id: r.id, evento: ++s.seq };
      },
      corrigirVacina: async (v) => {
        const x = s.vacinas.find((y) => y.id === v.id && y.paciente === v.paciente);
        if (!x) throw recusa('vacina-inexistente', 'A vacina não foi encontrada para este paciente.');
        if (x.correcoes.some((c) => c.tipo === 'estorno'))
          throw recusa('vacina-estornada', 'A vacina já foi estornada.');
        if (v.tipo === 'retificacao' && !v.dados)
          throw recusa('retificacao-vazia', 'Informe o que a retificação corrige.');
        const novaDose = v.tipo === 'retificacao' ? v.dados?.dose : undefined;
        if (
          novaDose &&
          ['D1', 'D2', 'D3', 'D4', 'DU'].includes(novaDose) &&
          s.vacinas.some(
            (y) =>
              y.id !== x.id &&
              y.paciente === x.paciente &&
              y.imunobiologico === x.imunobiologico &&
              doseVigente(y) === novaDose,
          )
        )
          throw recusa(
            'dose-ja-registrada',
            `A dose ${novaDose} deste imunobiológico já está registrada em outra aplicação do paciente.`,
          );
        const versao = x.correcoes.length + 1;
        const tipo = v.tipo === 'estorno' ? EVENTO_VACINA_CANCELADA : EVENTO_VACINA_SUBSTITUIDA;
        const outbox = String(++s.seq);
        s.fila.push({
          id: outbox,
          tipo,
          chave: `${tipo}|${String(v.id)}|${String(versao)}`,
          carga: { vacina: v.id, versao, paciente: v.paciente },
        });
        x.correcoes.push({
          versao,
          tipo: v.tipo,
          motivo: v.motivo,
          dados: v.dados ? (JSON.parse(JSON.stringify(v.dados)) as Record<string, string | null>) : null,
          usuario: v.usuario,
          em: agora.slice(0, 16),
          evento: 'pendente',
          entrega: null,
        });
        return { id: v.id, versao, evento: String(++s.seq), outbox };
      },
      registrarVacina: async (v) => {
        const ch = k(v.chave);
        const ja = ch ? s.vacinas.find((x) => x.chave === ch) : undefined;
        if (ja) {
          if (ja.paciente !== v.paciente)
            throw recusa(
              'chave-reutilizada',
              'A chave deste pedido já foi usada em outro registro: refaça na tela.',
            );
          return { id: ja.id, evento: `evento-${ja.id}`, repetida: true };
        }
        // Revisão W0-03: só a dose VIGENTE ocupa a chave (a estornada e a retificada para outra dose não).
        if (
          v.chaveDose &&
          s.vacinas.some(
            (x) =>
              x.paciente === v.paciente && x.imunobiologico === v.imunobiologico && doseVigente(x) === v.dose,
          )
        )
          throw recusa(
            'dose-ja-registrada',
            `A dose ${v.dose} deste imunobiológico já foi registrada para o paciente.`,
          );
        const id = ++s.seq;
        s.vacinas.unshift({
          id,
          paciente: v.paciente,
          imunobiologico: v.imunobiologico,
          nome: v.nome,
          lote: v.lote,
          fabricante: v.fabricante,
          validadeLote: v.validadeLote,
          dose: v.dose,
          via: v.via,
          local: v.local,
          aplicadaEm: v.aplicadaEm.slice(0, 16),
          prazoEnvio: v.prazoEnvio.slice(0, 16),
          evento: 'pendente',
          entrega: null,
          usuario: v.usuario,
          em: agora,
          correcoes: [],
          chaveDose: v.chaveDose,
          chave: ch,
        });
        s.fila.push({
          id: `evento-${id}`,
          tipo: 'fato.vacina.aplicada',
          chave: `fato.vacina.aplicada|${String(id)}`,
          carga: { vacina: id, paciente: v.paciente, atendimento: v.atendimento },
        });
        return { id, evento: `evento-${id}`, repetida: false };
      },
    };
    return fn(g);
  }

  async dominios() {
    return {
      escala: [1, 2, 3, 4, 5]
        .map((n) => ({ codigo: n, rotulo: String(n) }))
        .concat([{ codigo: 6, rotulo: 'NA' }]),
      metas: [
        { codigo: 1, rotulo: 'Aumentar para' },
        { codigo: 2, rotulo: 'Manter em' },
        { codigo: 3, rotulo: 'Diminuir para' },
      ],
    };
  }

  async terminologia(c: ContextoSae): Promise<TermoTerminologiaSae[]> {
    // A mesma regra da porta própria: a última edição de cada pacote (a CIPE não esconde a NNN); a memória não tem
    // catálogo de uso, então não há item próprio nem item tirado de uso.
    const t = this.e(c).termos;
    const vigentes = edicoesVigentesSae(
      t.map((x) => ({ pacote: x.sistema, edicao: x.versao, licenca: x.licenca })),
    );
    if (!vigentes) return [];
    return comporTerminologiaSae({
      vigentes,
      edicao: t
        .filter((x) => vigentes.vigentes.some((v) => v.pacote === x.sistema && v.edicao === x.versao))
        .map((x) => ({
          pacote: x.sistema,
          tipo: x.tipo,
          codigo: x.codigo,
          pai: x.pai,
          descricao: x.descricao,
          risco: x.risco,
        })),
      proprios: [],
      inativos: new Set(),
      paresExcluidos: new Set(),
    });
  }

  async sae(c: ContextoSae, atendimento: number) {
    const s = this.e(c);
    const vs = s.saes.filter((x) => x.atendimento === atendimento).sort((a, b) => a.versao - b.versao);
    const ult = vs.at(-1);
    return {
      versoes: vs.map((x) => ({ id: x.id, versao: x.versao, usuario: x.usuario, em: x.em })),
      cabecalho: ult
        ? {
            id: ult.id,
            versao: ult.versao,
            avaliacao: ult.avaliacao,
            sistema: ult.sistema,
            versaoTerminologia: ult.versaoTerminologia,
            usuario: ult.usuario,
            em: ult.em,
            registroProntuario: null,
          }
        : null,
      itens: ult ? s.itens.filter((i) => i.sae === ult.id) : [],
    };
  }

  private atividadeLida(s: Estado, a: Item): AtividadeVigente {
    const susp = s.itens.find((i) => i.tipo === 'suspensao' && i.pai === a.id);
    return {
      id: a.id,
      codigo: a.codigo,
      descricao: a.descricao,
      frequenciaDia: a.frequencia ?? 0,
      horarios: a.horarios,
      inicio: a.inicio ?? '',
      fim: a.fim,
      suspensa: susp ? { motivo: susp.nota ?? '', usuario: susp.usuario, em: susp.em } : null,
      usuario: a.usuario,
      em: a.em,
      atendimento: a.atendimento,
      sae: a.sae,
    };
  }

  async atividadesVigentes(c: ContextoSae, atendimentos: readonly number[]): Promise<AtividadeVigente[]> {
    const s = this.e(c);
    const ultimas = new Set(
      [...new Set(atendimentos)]
        .map((a) => s.saes.filter((x) => x.atendimento === a).sort((x, y) => y.versao - x.versao)[0]?.id)
        .filter((x): x is number => x !== undefined),
    );
    return s.itens
      .filter((i) => i.tipo === 'atividade' && ultimas.has(i.sae))
      .map((a) => this.atividadeLida(s, a));
  }

  async atividade(c: ContextoSae, id: number) {
    const s = this.e(c);
    const a = s.itens.find((i) => i.id === id && i.tipo === 'atividade');
    if (!a) return null;
    const v = s.saes.find((x) => x.id === a.sae)!;
    const nova = s.saes
      .filter((x) => x.atendimento === v.atendimento && x.versao > v.versao)
      .sort((x, y) => x.versao - y.versao)[0];
    return {
      ...this.atividadeLida(s, a),
      paciente: a.paciente,
      revisadoEm: nova ? nova.em.slice(0, 16) : null,
    };
  }

  private checagemLida(s: Estado, x: Checagem): ChecagemCuidadoLida & { atendimento: number } {
    const est = s.checagens.find((y) => y.estornado === x.id);
    return {
      id: x.id,
      atividade: x.item,
      atendimento: x.atendimento,
      previsto: x.previsto,
      feita: x.feita,
      motivo: x.motivo,
      horaReal: x.horaReal,
      origemOffline: x.origemOffline,
      categoria: x.categoria,
      usuario: x.usuario,
      em: x.em,
      estorno: est ? { id: est.id, motivo: est.motivo ?? '', usuario: est.usuario } : null,
    };
  }

  async checagens(c: ContextoSae, o: { atividades: readonly number[]; de: string; ate: string }) {
    const s = this.e(c);
    const ids = new Set(o.atividades);
    return {
      itens: s.checagens
        .filter(
          (x) =>
            x.tipo === 'checagem' &&
            ids.has(x.item) &&
            x.previsto >= o.de.slice(0, 16) &&
            x.previsto < o.ate.slice(0, 16),
        )
        .map((x) => this.checagemLida(s, x)),
      cortada: false,
    };
  }

  async checagem(c: ContextoSae, id: number) {
    const s = this.e(c);
    const x = s.checagens.find((y) => y.id === id && y.tipo === 'checagem');
    return x ? this.checagemLida(s, x) : null;
  }

  async consulta(c: ContextoSae, atendimento: number): Promise<ConsultaDeEnfermagem | null> {
    if (atendimento === CONSULTA_ENFERMAGEM_SINTETICA || atendimento === CONSULTA_MEDICA_SINTETICA) {
      const enf = atendimento === CONSULTA_ENFERMAGEM_SINTETICA;
      const agora = await this.agora(c);
      return {
        atendimento,
        paciente: PACIENTE_CONSULTA,
        numero: atendimento + 2,
        nome: `PACIENTE ${M} CONSULTA`,
        tipo: 'E',
        entrada: `${agora.slice(0, 10)}T08:00`,
        vinculoDoAtendimento: enf ? VINCULO_ENFERMEIRO : 92_599,
        cboDoAtendimento: enf ? '223505' : '225125',
        ativo: true,
      };
    }
    const i = await this.enfermagem.internado(c, atendimento);
    return i
      ? {
          atendimento,
          paciente: i.paciente,
          numero: i.numero,
          nome: i.nome,
          tipo: 'I',
          entrada: null,
          vinculoDoAtendimento: null,
          cboDoAtendimento: null,
          ativo: true,
        }
      : null;
  }

  async consultasDoProfissional(c: ContextoSae, o: { vinculos: readonly number[]; dia: string }) {
    if (!o.vinculos.includes(VINCULO_ENFERMEIRO)) return [];
    const x = (await this.consulta(c, CONSULTA_ENFERMAGEM_SINTETICA))!;
    return [
      {
        atendimento: x.atendimento,
        paciente: x.paciente,
        numero: x.numero,
        nome: x.nome,
        entrada: x.entrada,
      },
    ];
  }

  async externosDoDia(c: ContextoSae) {
    const x = (await this.consulta(c, CONSULTA_ENFERMAGEM_SINTETICA))!;
    const y = (await this.consulta(c, CONSULTA_MEDICA_SINTETICA))!;
    return {
      itens: [x, y].map((a) => ({
        atendimento: a.atendimento,
        paciente: a.paciente,
        numero: a.numero,
        nome: a.nome,
        entrada: a.entrada,
      })),
      cortada: false,
    };
  }

  async cabecalhoReceita(_c: ContextoSae, o: { paciente: number; vinculo: number }) {
    return {
      instituicao: `ESTABELECIMENTO ${M}`,
      cnpj: '00000000000191',
      paciente: o.paciente === PACIENTE_CONSULTA ? `PACIENTE ${M} CONSULTA` : `PACIENTE ${M}`,
      nascimento: '1980-01-01',
      cpf: '11144477735',
      prescritor: o.vinculo === VINCULO_ENFERMEIRO ? `ENFERMEIRA ${M} PLANTAO` : `PROFISSIONAL ${M}`,
      conselho: 'COREN-RJ 000000',
      categoria: 'Enfermeiro',
    };
  }

  async receitas(c: ContextoSae, atendimento: number) {
    return this.e(c).receitas.filter((r) => r.atendimento === atendimento);
  }

  async vacinas(c: ContextoSae, paciente: number) {
    return this.e(c).vacinas.filter((v) => v.paciente === paciente);
  }

  async recusasRia(c: ContextoSae): Promise<RecusaEnvioVacina[]> {
    return [...this.e(c).recusas];
  }

  /** W0-03 (M6, testes): uma recusa do RIA como o conector gravaria na SGH_INTG_ENVIO. */
  simularRecusaRia(c: ContextoSae, r: RecusaEnvioVacina): void {
    this.e(c).recusas.unshift(r);
  }

  /** W0-03 (testes): a fila de saída da memória, como a SGH_OUTBOX guardaria. */
  fila(
    hospital: string,
  ): readonly { id: string; tipo: string; chave: string; carga: Record<string, number> }[] {
    return this.estados.get(hospital)?.fila ?? [];
  }
}
