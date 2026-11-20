// W0-03, mercado M4: as feridas e LPP na porta em memória (a sessão sintética de dev/ci, E2E), com as mesmas recusas da
// gravação SGH_ (packages/legado/src/enfermagem/gravacao/lesao.ts). Nada vai à cópia. O anexo da foto não é conferido
// contra o prontuário aqui (a memória não tem os anexos do legado): só a unicidade do vínculo.
import type { LesaoLidaSgh } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { GravadorEscores } from './escores-porta.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não gravado', detalhe, { codigo });

type Mutavel<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
type LesaoMemoria = Mutavel<LesaoLidaSgh>;

export interface EstadoLesoes {
  seq: number;
  lesoes?: LesaoLidaSgh[];
}

type GravadorLesao = Pick<
  GravadorEscores,
  | 'registrarLesao'
  | 'versaoLesao'
  | 'curativoLesao'
  | 'corrigirCurativoLesao'
  | 'fotoLesao'
  | 'encerrarLesao'
  | 'inativarLesao'
>;

const limpo = (m: string | null | undefined) => (m ?? '').replace(/\s+/g, ' ').trim();
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function gravadorLesaoMemoria(copia: EstadoLesoes, agora: () => string): GravadorLesao {
  const lista = () => (copia.lesoes ??= []) as LesaoMemoria[];
  const evento = (l: LesaoMemoria, origem: 'lesao' | 'curativo' | 'foto', registro: number, tipo: string) =>
    l.eventos.some((e) => e.origem === origem && e.registro === registro && e.tipo === tipo);
  const achar = (id: number) => {
    const l = lista().find((x) => x.id === id);
    if (!l) throw recusa('lesao-inexistente', 'A lesão não foi encontrada.');
    return l;
  };
  const aberta = (l: LesaoMemoria) => {
    if (evento(l, 'lesao', l.id, 'inativacao'))
      throw recusa('lesao-inativada', 'A lesão foi inativada (lançada errada).');
    if (evento(l, 'lesao', l.id, 'encerramento'))
      throw recusa('lesao-encerrada', 'O acompanhamento da lesão foi encerrado.');
  };
  const identificadaEm = (l: LesaoMemoria): string => {
    try {
      return String((JSON.parse(l.versoes[0]!.dados) as { identificadaEm?: string }).identificadaEm ?? '');
    } catch {
      return '';
    }
  };
  const curativo = (id: number) => {
    for (const l of lista()) {
      const c = l.curativos.find((x) => x.id === id);
      if (c)
        return {
          l,
          c,
          seguinte: l.curativos.some((x) => x.anterior === id),
          inativo: evento(l, 'curativo', id, 'inativacao'),
        };
    }
    throw recusa('curativo-inexistente', 'O curativo não foi encontrado.');
  };
  const inativar = (
    l: LesaoMemoria,
    origem: 'lesao' | 'curativo' | 'foto',
    registro: number,
    autor: string,
    x: { motivo: string; usuario: string },
  ) => {
    if (!mesmo(autor, x.usuario))
      throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
    if (evento(l, origem, registro, 'inativacao'))
      throw recusa('ja-inativado', 'O registro já foi inativado.');
    const id = ++copia.seq;
    l.eventos.push({
      origem,
      registro,
      tipo: 'inativacao',
      desfecho: null,
      em: agora().slice(0, 16),
      motivo: limpo(x.motivo).slice(0, 300),
      usuario: x.usuario,
      criadoEm: agora(),
    });
    return { id, paciente: l.paciente, lesao: l.id };
  };
  return {
    registrarLesao: async (r) => {
      if (r.dados.length > 2000) throw recusa('ficha-grande', 'A ficha passa do tamanho máximo.');
      const id = ++copia.seq;
      const idVersao = ++copia.seq;
      lista().push({
        id,
        paciente: r.paciente,
        atendimento: r.atendimento,
        unidade: r.unidade ? r.unidade.slice(0, 5) : null,
        uti: r.uti,
        autor: r.autor,
        criadoEm: agora(),
        versoes: [
          {
            id: idVersao,
            versao: 1,
            anterior: null,
            situacao: r.situacao,
            dados: r.dados,
            motivo: null,
            autor: r.autor,
            criadoEm: agora(),
          },
        ],
        curativos: [],
        fotos: [],
        eventos: [],
      });
      return { id, versao: 1, idVersao };
    },
    versaoLesao: async (v) => {
      const l = achar(v.lesao);
      aberta(l);
      const atual = l.versoes[0]!;
      if (!mesmo(l.autor, v.autor)) throw recusa('so-o-autor', 'Só quem registrou a ficha pode corrigi-la.');
      if (atual.id !== v.anterior)
        throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
      let motivo: string | null = null;
      if (atual.situacao === 'finalizada') {
        motivo = limpo(v.motivo);
        if (motivo.length < 10)
          throw recusa('motivo-obrigatorio', 'A correção da ficha finalizada exige a justificativa.');
        if (v.situacao !== 'finalizada')
          throw recusa(
            'correcao-finaliza',
            'A correção da ficha finalizada é gravada finalizada (a ficha não volta a rascunho).',
          );
      }
      const id = ++copia.seq;
      l.versoes.unshift({
        id,
        versao: atual.versao + 1,
        anterior: atual.id,
        situacao: v.situacao,
        dados: v.dados,
        motivo,
        autor: v.autor,
        criadoEm: agora(),
      });
      return { id, versao: atual.versao + 1, paciente: l.paciente };
    },
    curativoLesao: async (c) => {
      const l = achar(c.lesao);
      aberta(l);
      if (c.realizadoEm < identificadaEm(l))
        throw recusa('curativo-antes-da-lesao', 'O curativo é anterior à identificação da lesão.');
      const id = ++copia.seq;
      l.curativos.unshift({
        id,
        anterior: null,
        realizadoEm: c.realizadoEm,
        dados: c.dados,
        motivo: null,
        autor: c.autor,
        criadoEm: agora(),
      });
      return { id, paciente: l.paciente };
    },
    corrigirCurativoLesao: async (c) => {
      const motivo = limpo(c.motivo);
      if (motivo.length < 10)
        throw recusa('motivo-obrigatorio', 'A correção do curativo exige a justificativa.');
      const k = curativo(c.anterior);
      if (!mesmo(k.c.autor, c.autor))
        throw recusa('so-o-autor', 'Só quem registrou o curativo pode corrigi-lo.');
      if (k.inativo) throw recusa('curativo-inativado', 'O curativo foi inativado (lançado errado).');
      if (k.seguinte)
        throw recusa('curativo-desatualizado', 'O curativo já foi corrigido: abra a versão atual.');
      aberta(k.l);
      if (c.realizadoEm < identificadaEm(k.l))
        throw recusa('curativo-antes-da-lesao', 'O curativo é anterior à identificação da lesão.');
      const id = ++copia.seq;
      k.l.curativos.unshift({
        id,
        anterior: c.anterior,
        realizadoEm: c.realizadoEm,
        dados: c.dados,
        motivo: motivo.slice(0, 300),
        autor: c.autor,
        criadoEm: agora(),
      });
      return { id, lesao: k.l.id, paciente: k.l.paciente };
    },
    fotoLesao: async (f) => {
      const l = achar(f.lesao);
      aberta(l);
      if (f.curativo !== null) {
        const k = curativo(f.curativo);
        if (k.l.id !== f.lesao) throw recusa('curativo-de-outra-lesao', 'O curativo é de outra lesão.');
        if (k.inativo || k.seguinte)
          throw recusa('curativo-nao-vigente', 'O curativo foi corrigido ou inativado: abra o vigente.');
      }
      if (lista().some((x) => x.fotos.some((y) => y.anexo === f.anexo)))
        throw recusa('foto-ja-vinculada', 'Esta foto já está vinculada a uma lesão.');
      const id = ++copia.seq;
      l.fotos.unshift({
        id,
        curativo: f.curativo,
        anexo: f.anexo,
        tiradaEm: f.tiradaEm,
        usuario: f.usuario,
      });
      return { id, paciente: l.paciente };
    },
    encerrarLesao: async (x) => {
      const l = achar(x.lesao);
      aberta(l);
      if (l.versoes[0]!.situacao !== 'finalizada')
        throw recusa('lesao-em-rascunho', 'Finalize a ficha da lesão antes de encerrar o acompanhamento.');
      if (x.em < identificadaEm(l))
        throw recusa('encerramento-antes-da-lesao', 'O encerramento é anterior à identificação da lesão.');
      const id = ++copia.seq;
      l.eventos.push({
        origem: 'lesao',
        registro: l.id,
        tipo: 'encerramento',
        desfecho: x.desfecho,
        em: x.em,
        motivo: x.observacao ? limpo(x.observacao).slice(0, 300) || null : null,
        usuario: x.usuario,
        criadoEm: agora(),
      });
      return { id, paciente: l.paciente };
    },
    inativarLesao: async (x) => {
      if (limpo(x.motivo).length < 10) throw recusa('motivo-obrigatorio', 'Informe o motivo da inativação.');
      if (x.origem === 'lesao') {
        const l = achar(x.id);
        if (evento(l, 'lesao', l.id, 'inativacao'))
          throw recusa('ja-inativado', 'O registro já foi inativado.');
        if (mesmo(l.autor, x.usuario)) {
          const curativos = l.curativos.filter(
            (c) =>
              !l.curativos.some((s) => s.anterior === c.id) && !evento(l, 'curativo', c.id, 'inativacao'),
          ).length;
          const fotos = l.fotos.filter((f) => !evento(l, 'foto', f.id, 'inativacao')).length;
          if (curativos + fotos > 0)
            throw recusa(
              'lesao-com-registros',
              `A lesão tem ${curativos} curativo(s) e ${fotos} foto(s) vigentes: inative-os antes da lesão.`,
            );
        }
        return inativar(l, 'lesao', l.id, l.autor, x);
      }
      if (x.origem === 'curativo') {
        const k = curativo(x.id);
        if (k.inativo) throw recusa('ja-inativado', 'O registro já foi inativado.');
        if (k.seguinte)
          throw recusa('curativo-desatualizado', 'O curativo já foi corrigido: inative a versão atual.');
        if (mesmo(k.c.autor, x.usuario)) {
          const versoes = new Set<number>([x.id]);
          for (let c = k.c; c.anterior !== null && !versoes.has(c.anterior);) {
            versoes.add(c.anterior);
            const ant = k.l.curativos.find((y) => y.id === c.anterior);
            if (!ant) break;
            c = ant;
          }
          const fotos = k.l.fotos.filter(
            (f) => f.curativo !== null && versoes.has(f.curativo) && !evento(k.l, 'foto', f.id, 'inativacao'),
          ).length;
          if (fotos > 0)
            throw recusa(
              'curativo-com-fotos',
              `O curativo tem ${fotos} foto(s) vigente(s): inative a(s) ${fotos} foto(s) antes do curativo.`,
            );
        }
        return inativar(k.l, 'curativo', x.id, k.c.autor, x);
      }
      const l = lista().find((y) => y.fotos.some((f) => f.id === x.id));
      if (!l) throw recusa('foto-inexistente', 'A foto não foi encontrada.');
      return inativar(l, 'foto', x.id, l.fotos.find((f) => f.id === x.id)!.usuario, x);
    },
  };
}

/** A leitura da memória com os mesmos filtros da gravação SGH_. */
export function lesoesMemoria(
  lesoes: readonly LesaoLidaSgh[] | undefined,
  f: { id?: number; atendimentos?: readonly number[]; desde?: string; ate?: string },
): LesaoLidaSgh[] {
  const ats = f.atendimentos ? new Set(f.atendimentos) : null;
  const ident = (l: LesaoLidaSgh) =>
    l.versoes.map((v) => {
      try {
        return String((JSON.parse(v.dados) as { identificadaEm?: string }).identificadaEm ?? '');
      } catch {
        return '';
      }
    });
  return structuredClone(
    (lesoes ?? [])
      .filter((l) =>
        f.id !== undefined
          ? l.id === f.id
          : ats
            ? ats.has(l.atendimento)
            : ident(l).some(
                (i) =>
                  i >= (f.desde ?? '1900-01-01T00:00').slice(0, 16) && (!f.ate || i < f.ate.slice(0, 16)),
              ),
      )
      .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : b.id - a.id)),
  );
}
