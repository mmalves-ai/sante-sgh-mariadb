// Porta do prontuário sobre o núcleo do legado (M15): cada leitura numa transação curta READ ONLY (os BLOB
// materializados antes do fim dela), pelos repositórios de @sgh/legado. Nada grava em tabela do legado. Fora
// de dev/ci, sem o núcleo, a porta indisponível responde 503 (falha fechada).
import {
  eventosDoDocumento,
  excecoesDoProntuario,
  fontesDosRegistros,
  type Leitor,
  lerAcessosProntuario,
  lerConteudoRegistro,
  lerContextoAto,
  lerDefinicaoFormulario,
  lerDocumentoEmitidoXml,
  lerRegistroDoPaciente,
  lerRepresentacaoGravada,
  lerRespostasRegistro,
  listarModelosFormulario,
  listarRegistrosPaciente,
  type NucleoLegado,
  resumoDoProntuario,
  seloDoModelo,
  textosDoPaciente,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoProntuario, PortaProntuario } from './porta.js';

export function portaProntuarioLegado(nucleo: Pick<NucleoLegado, 'lerSomente'>): PortaProntuario {
  const ler = <T>(c: ContextoProntuario, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'prontuario' }, fn);
  return {
    destino: 'legado',
    listar: (c, paciente, filtro, pagina, por) =>
      ler(c, async (l) => {
        const r = await listarRegistrosPaciente(l, paciente, filtro, pagina, por);
        return { ...r, fontes: await fontesDosRegistros(l, r.registros) };
      }),
    resumo: (c, paciente) => ler(c, (l) => resumoDoProntuario(l, paciente)),
    excecoes: (c) => ler(c, (l) => excecoesDoProntuario(l)),
    registro: (c, paciente, id) =>
      ler(c, async (l) => {
        const registro = await lerRegistroDoPaciente(l, paciente, id);
        if (!registro) return null;
        const fontes = (await fontesDosRegistros(l, [registro])).get(registro.id);
        return fontes ? { registro, fontes } : null;
      }),
    conteudo: (c, id, partes) => ler(c, (l) => lerConteudoRegistro(l, id, partes)),
    eventosDocumento: (c, r) => ler(c, (l) => eventosDoDocumento(l, r)),
    documentoXml: (c, id) => ler(c, (l) => lerDocumentoEmitidoXml(l, id)),
    respostas: (c, id) => ler(c, (l) => lerRespostasRegistro(l, id)),
    seloDoModelo: (c, modelo) => ler(c, (l) => seloDoModelo(l, modelo)),
    representacaoGravada: (c, modelo, selo) =>
      ler(c, (l) => lerRepresentacaoGravada(l, c.hospital, modelo, selo)),
    definicaoModelo: (c, modelo) =>
      ler(c, async (l) => {
        const m = (await listarModelosFormulario(l)).find((x) => x.id === modelo);
        return m ? lerDefinicaoFormulario(l, m) : null;
      }),
    contexto: (c, id) => ler(c, (l) => lerContextoAto(l, id)),
    textos: (c, paciente, filtro, teto) => ler(c, (l) => textosDoPaciente(l, paciente, filtro, teto)),
    acessos: (c, filtro, pagina, por) =>
      ler(c, (l) => lerAcessosProntuario(l, c.hospital, filtro, pagina, por)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido). */
export function portaProntuarioIndisponivel(): PortaProntuario {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido.',
      ),
    );
  return {
    destino: 'legado',
    listar: recusa,
    resumo: recusa,
    excecoes: recusa,
    registro: recusa,
    conteudo: recusa,
    eventosDocumento: recusa,
    documentoXml: recusa,
    respostas: recusa,
    seloDoModelo: recusa,
    representacaoGravada: recusa,
    definicaoModelo: recusa,
    contexto: recusa,
    textos: recusa,
    acessos: recusa,
  };
}
