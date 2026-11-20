// W1-04 (mercado): os termos de consentimento na sessão sintética (dev/ci, E2E), com as mesmas regras do legado
// (packages/legado/src/recepcao/gravacao/termos.ts): versão nova em vez de sobrescrever, situação por fato, exclusão só
// do código nunca assinado, assinatura imutável com hash do conteúdo canônico e revogação única.
import {
  type AssinaturaTermo,
  codificarCp1252,
  conteudoCanonicoAssinatura,
  type ModeloTermo,
  type VersaoModeloTermo,
} from '@sgh/contratos';
import { recusa } from '@sgh/legado';
import { createHash } from 'node:crypto';
import type { GravadorTermos } from './porta.js';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface CodigoM {
  codigo: string;
  finalidade: ModeloTermo['finalidade'];
  ativo: boolean;
  versoes: VersaoModeloTermo[];
}

interface Estado {
  codigos: CodigoM[];
  assinaturas: AssinaturaTermo[];
  seq: number;
}

export class TermosMemoria {
  private readonly estados = new Map<string, Estado>();

  private e(hospital: string): Estado {
    let s = this.estados.get(hospital);
    if (!s) {
      s = { codigos: [], assinaturas: [], seq: 0 };
      this.estados.set(hospital, s);
    }
    return s;
  }

  modelos(hospital: string): ModeloTermo[] {
    const s = this.e(hospital);
    return s.codigos.map((c) => {
      const ids = new Set(c.versoes.map((v) => v.id));
      return {
        codigo: c.codigo,
        finalidade: c.finalidade,
        ativo: c.ativo,
        versoes: [...c.versoes].sort((a, b) => b.versao - a.versao),
        assinaturas: s.assinaturas.filter((a) => ids.has(a.modelo)).length,
      };
    });
  }

  assinaturas(hospital: string, prontuario: number): AssinaturaTermo[] {
    return this.e(hospital)
      .assinaturas.filter((a) => a.prontuario === prontuario)
      .sort((a, b) => b.id - a.id);
  }

  gravador(hospital: string, agora: string, existePaciente: (p: number) => boolean): GravadorTermos {
    const s = this.e(hospital);
    const codigo = (k: string) => {
      const c = s.codigos.find((x) => x.codigo === k);
      if (!c) throw recusa('termo-inexistente', 'Termo não encontrado.');
      return c;
    };
    const versao = (
      x: {
        titulo: string;
        tiposAtendimento: readonly string[];
        exigido: boolean;
        texto: string;
        usuario: string;
      },
      n: number,
    ): VersaoModeloTermo => ({
      id: ++s.seq,
      versao: n,
      titulo: x.titulo,
      tiposAtendimento: [...x.tiposAtendimento] as VersaoModeloTermo['tiposAtendimento'],
      exigido: x.exigido,
      texto: x.texto,
      hashTexto: sha256(codificarCp1252(x.texto)),
      criadoPor: x.usuario,
      criadoEm: agora,
    });
    return {
      incluirModeloTermo: async (x) => {
        if (s.codigos.some((c) => c.codigo === x.codigo))
          throw recusa('termo-codigo-existe', 'Já existe um termo com este código: altere-o (nova versão).', {
            campos: ['codigo'],
          });
        const v = versao(x, 1);
        s.codigos.push({ codigo: x.codigo, finalidade: x.finalidade, ativo: true, versoes: [v] });
        return v.id;
      },
      novaVersaoModeloTermo: async (x) => {
        const c = codigo(x.codigo);
        const ultima = Math.max(...c.versoes.map((v) => v.versao));
        if (ultima !== x.versaoVista)
          throw recusa('termo-concorrente', `Há uma versão mais nova (${ultima}): abra de novo e refaça.`);
        const v = versao(x, ultima + 1);
        c.versoes.push(v);
        return { id: v.id, versao: v.versao };
      },
      situacaoModeloTermo: async (x) => {
        const c = codigo(x.codigo);
        if (c.ativo === x.ativo)
          throw recusa('termo-situacao', x.ativo ? 'O termo já está ativo.' : 'O termo já está inativo.');
        c.ativo = x.ativo;
      },
      excluirModeloTermo: async (x) => {
        const c = codigo(x.codigo);
        const ids = new Set(c.versoes.map((v) => v.id));
        const n = s.assinaturas.filter((a) => ids.has(a.modelo)).length;
        if (n > 0)
          throw recusa(
            'com-dependentes',
            `O termo tem ${n} assinatura(s) de pacientes: não pode ser excluído. Inative-o.`,
            {
              dependentes: [{ rotulo: 'Termos assinados', quantidade: n, amostra: [], origem: 'fk' }],
              podeInativar: true,
            },
          );
        s.codigos = s.codigos.filter((y) => y !== c);
      },
      assinarTermo: async (x) => {
        const c = s.codigos.find((y) => y.versoes.some((v) => v.id === x.modelo));
        const v = c?.versoes.find((y) => y.id === x.modelo);
        if (!c || !v) throw recusa('termo-inexistente', 'Termo não encontrado.', { campos: ['modelo'] });
        if (!c.ativo) throw recusa('termo-inativo', 'O termo está inativo.', { campos: ['modelo'] });
        if (c.versoes.some((y) => y.versao > v.versao))
          throw recusa('termo-versao-antiga', 'Há uma versão mais nova deste termo: abra de novo.', {
            campos: ['modelo'],
          });
        if (!existePaciente(x.prontuario))
          throw recusa('paciente-inexistente', 'Prontuário não encontrado.', { campos: ['prontuario'] });
        const imagem = x.imagem ? Buffer.from(x.imagem, 'base64') : null;
        const hash = sha256(
          conteudoCanonicoAssinatura({
            modelo: x.modelo,
            hashTexto: v.hashTexto,
            prontuario: x.prontuario,
            senha: x.senha,
            tipoAtendimento: x.tipoAtendimento,
            meio: x.meio,
            signatario: x.signatario,
            nomeSignatario: x.nomeSignatario,
            assinadoEm: agora,
            hashImagem: imagem ? sha256(imagem) : null,
          }),
        );
        const id = ++s.seq;
        s.assinaturas.push({
          id,
          modelo: v.id,
          codigo: c.codigo,
          versao: v.versao,
          titulo: v.titulo,
          finalidade: c.finalidade,
          prontuario: x.prontuario,
          senha: x.senha,
          tipoAtendimento: x.tipoAtendimento,
          meio: x.meio,
          signatario: x.signatario,
          nomeSignatario: x.nomeSignatario,
          hash,
          assinadoEm: agora,
          registradoPor: x.usuario,
          revogacao: null,
        });
        return { id, hash };
      },
      revogarTermo: async (x) => {
        const i = s.assinaturas.findIndex((a) => a.id === x.assinatura);
        const a = s.assinaturas[i];
        if (!a) throw recusa('termo-inexistente', 'Termo assinado não encontrado.');
        if (a.revogacao) throw recusa('termo-revogado', 'Este termo já foi revogado.');
        s.assinaturas[i] = { ...a, revogacao: { motivo: x.motivo, usuario: x.usuario, em: agora } };
      },
    };
  }
}
