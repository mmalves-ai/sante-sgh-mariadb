// W0-03, mercado M4: a montagem da lesão para a tela (a ficha vigente e as versões anteriores legíveis, os curativos
// com a vigência e a área, as fotos, o encerramento, a inativação e a sugestão ao NSP) e a incidência de LPP do
// período (com o numerador e o denominador), a partir das leituras SGH_. Sem banco: o controlador lê e chama aqui.
import {
  type CurativoEntrada,
  type CurativoLido,
  type DadosLesao,
  type DesfechoLesao,
  esquemaCurativo,
  esquemaDadosLesao,
  type IncidenciaLpp,
  type InativacaoLesaoLida,
  type LesaoLida,
} from '@sgh/contratos';
import { areaLesao, incidenciaLpp, origemDaLesao, sugestaoNotificacaoLpp } from '@sgh/dominio-enfermagem';
import type { EventoLesaoRegistrado, LesaoRegistrada } from './tipos.js';

/** A ficha gravada (JSON validado pelo contrato; a gravação só aceita o que o contrato validou). */
export function dadosDaFicha(json: string): DadosLesao | null {
  try {
    const r = esquemaDadosLesao.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function dadosDoCurativo(json: string): CurativoEntrada | null {
  try {
    const r = esquemaCurativo.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const inativacao = (
  eventos: readonly EventoLesaoRegistrado[],
  origem: EventoLesaoRegistrado['origem'],
  registro: number,
): InativacaoLesaoLida | null => {
  const e = eventos.find((x) => x.origem === origem && x.registro === registro && x.tipo === 'inativacao');
  return e ? { motivo: e.motivo ?? '', usuario: e.usuario, em: e.criadoEm || e.em } : null;
};

/** As colunas que os indicadores filtram, tiradas da ficha (a gravação as guarda fora do JSON). */
export function colunasDaFicha(d: DadosLesao) {
  return {
    tipo: d.tipo,
    regiao: d.regiao,
    estagio: d.tipo === 'lpp' ? d.estagio : null,
    presenteNaAdmissao: d.presenteNaAdmissao,
    identificadaEm: d.identificadaEm,
  };
}

/** A lesão para a tela; null se a ficha vigente não se lê (nunca deveria: a gravação valida pelo contrato). */
export function lesaoParaTela(l: LesaoRegistrada): LesaoLida | null {
  const vigente = l.versoes[0];
  const dados = vigente ? dadosDaFicha(vigente.dados) : null;
  if (!vigente || !dados) return null;
  const inativ = inativacao(l.eventos, 'lesao', l.id);
  const enc = l.eventos.find((e) => e.origem === 'lesao' && e.tipo === 'encerramento');
  const curativos: CurativoLido[] = l.curativos.flatMap((c) => {
    const d = dadosDoCurativo(c.dados);
    if (!d) return [];
    const ina = inativacao(l.eventos, 'curativo', c.id);
    return [
      {
        id: c.id,
        lesao: l.id,
        anterior: c.anterior,
        dados: d,
        areaCm2: areaLesao(d.medidas),
        autor: c.autor,
        criadoEm: c.criadoEm,
        motivo: c.motivo,
        inativacao: ina,
        vigente: ina === null && !l.curativos.some((x) => x.anterior === c.id),
      },
    ];
  });
  return {
    id: l.id,
    paciente: l.paciente,
    atendimento: l.atendimento,
    unidade: l.unidade,
    uti: l.uti,
    versao: vigente.versao,
    situacao: vigente.situacao,
    dados,
    origem: origemDaLesao(dados),
    areaCm2: areaLesao(dados.medidas),
    autor: l.autor,
    criadoEm: l.criadoEm,
    motivo: vigente.motivo,
    encerramento: enc
      ? { desfecho: (enc.desfecho ?? 'cicatrizada') as DesfechoLesao, em: enc.em, usuario: enc.usuario }
      : null,
    inativacao: inativ,
    versoes: l.versoes.slice(1).map((v) => ({
      id: v.id,
      versao: v.versao,
      situacao: v.situacao,
      criadoEm: v.criadoEm,
      autor: v.autor,
      motivo: v.motivo,
      dados: dadosDaFicha(v.dados),
    })),
    curativos,
    fotos: l.fotos.map((f) => ({
      id: f.id,
      anexo: f.anexo,
      curativo: f.curativo,
      tiradaEm: f.tiradaEm,
      usuario: f.usuario,
      inativacao: inativacao(l.eventos, 'foto', f.id),
    })),
    sugerirNotificacao: sugestaoNotificacaoLpp({
      tipo: dados.tipo,
      estagio: dados.estagio,
      presenteNaAdmissao: dados.presenteNaAdmissao,
      situacao: vigente.situacao,
      inativada: inativ !== null,
    }).sugerir,
  };
}

/**
 * A incidência de LPP do período [de, ate] (datas AAAA-MM-DD): as lesões identificadas no período (a ficha vigente),
 * os pacientes-dia do censo e os pacientes internados no período.
 */
export function incidenciaDoPeriodo(
  lesoes: readonly LesaoLida[],
  pacientesDia: number,
  internados: number,
  de: string,
  ate: string,
): IncidenciaLpp {
  return incidenciaLpp(
    lesoes.map((l) => ({
      paciente: l.paciente,
      identificadaEm: l.dados.identificadaEm,
      tipo: l.dados.tipo,
      estagio: l.dados.estagio,
      presenteNaAdmissao: l.dados.presenteNaAdmissao,
      situacao: l.situacao,
      inativada: l.inativacao !== null,
    })),
    pacientesDia,
    internados,
    de,
    ate,
  );
}
