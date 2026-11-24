<script setup lang="ts">
// Complemento do cadastro do profissional (F3.1, 02-CAD linha 16) na própria ficha: RQE e assinatura para quem lê o
// profissional; dados fiscais do repasse e contas só para o cargo do repasse (cadastro.profissionalFinanceiro.*). Cada
// bloco inclui numa linha e encerra ou inativa (nada se apaga). A validação na hora só evita o vaivém: o servidor
// confere de novo pela regra do domínio.
import { SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type Complemento,
  encerrarComplemento,
  enviarImagemAssinatura,
  type Financeiro,
  gravarDadoFiscal,
  incluirAssinatura,
  incluirConta,
  incluirRqe,
  lerComplemento,
  lerFinanceiro,
  lerOpcoesComplemento,
  type OpcoesComplemento,
  type TipoComplemento,
} from '../api-complemento-profissional.js';

const props = defineProps<{ idProfissional: number }>();
const ufs = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const { t } = useI18n();
const T = (k: string) => t(`complementoProfissional.${k}`);

const podeEditar = computed(() => pode('cadastro.profissional.editar'));
const podeVerFinanceiro = computed(() => pode('cadastro.profissionalFinanceiro.ler'));
const podeEditarFinanceiro = computed(() => pode('cadastro.profissionalFinanceiro.editar'));

const comp = ref<Complemento | null>(null);
const fin = ref<Financeiro | null>(null);
const opcoes = ref<OpcoesComplemento | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref('');
const hoje = new Date().toISOString().slice(0, 10);
// O regime acompanha o recebedor (a mesma regra do domínio): autônomo é pessoa física; Simples, MEI e lucro são de empresa.
const REGIMES_PF = ['autonomo', 'isento', 'outro'];
const REGIMES_PJ = ['simples_nacional', 'mei', 'lucro_presumido', 'lucro_real', 'isento', 'outro'];

const rqe = ref({ numero: '', uf: '', especialidade: 0, dataRegistro: '' });
const ass = ref({
  tipo: 'certificado_digital' as 'imagem' | 'certificado_digital',
  titular: '',
  numeroSerie: '',
  emissor: '',
  impressaoDigital: '',
  usoTiss: false,
  vigenciaInicio: hoje,
});
// A imagem da assinatura escolhida na tela (PNG ou JPEG, até 512 KB), enviada em base64 com o resto do formulário.
const imagem = ref<{ conteudo: string; nome: string } | null>(null);
const imagemErro = ref('');
function escolherImagem(ev: Event): void {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  imagem.value = null;
  imagemErro.value = '';
  if (!arq) return;
  if (!/^image\/(png|jpeg)$/.test(arq.type) || arq.size > 512 * 1024) {
    imagemErro.value = T('assinatura.imagemInvalida');
    return;
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    imagem.value = { conteudo: String(leitor.result), nome: arq.name };
  };
  leitor.readAsDataURL(arq);
}
const fiscal = ref({
  estabelecimento: 0,
  vigenciaInicio: hoje,
  tipoRecebedor: 'pessoa_fisica',
  pessoaJuridica: 0,
  regime: 'autonomo',
  pisPasep: '',
  inscricaoMunicipal: '',
  inscricaoInss: '',
  categoriaSefip: '',
  aliquotaIss: '',
  percentualInss: '',
  retemIss: false,
  retemInss: false,
  retemIrrf: false,
  retemPisCofinsCsll: false,
  dependentesIrrf: 0,
  incidencia: 'pagamento',
});
const buscaEmpresa = ref('');
const conta = ref({
  banco: 0,
  tipoConta: 0,
  agencia: '',
  numeroConta: '',
  contaDigito: '',
  tipoChavePix: '',
  chavePix: '',
  favorecidoNome: '',
  favorecidoTipo: 'fisica',
  favorecidoDocumento: '',
  principal: false,
  confirmaTerceiro: false,
});

async function carregar(): Promise<void> {
  try {
    comp.value = await lerComplemento(props.idProfissional);
    if (podeVerFinanceiro.value) fin.value = await lerFinanceiro(props.idProfissional);
    if (!opcoes.value) opcoes.value = await lerOpcoesComplemento();
  } catch (e) {
    erro.value = e;
  }
}
onMounted(carregar);
watch(() => props.idProfissional, carregar);

let espera: ReturnType<typeof setTimeout> | undefined;
watch(buscaEmpresa, (v) => {
  clearTimeout(espera);
  if (v.trim().length < 3) return;
  espera = setTimeout(async () => {
    try {
      const o = await lerOpcoesComplemento(v.trim());
      if (opcoes.value) opcoes.value.empresas = o.empresas;
    } catch (e) {
      erro.value = e;
    }
  }, 300);
});

async function agir(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  try {
    await fn();
    mensagem.value = ok;
    await carregar();
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

const encerrar = (tipo: TipoComplemento, id: number, versao: number) =>
  agir(() => encerrarComplemento(props.idProfissional, tipo, id, versao), T('encerradoOk'));

// Validação na hora (o servidor confere de novo).
const rqeOk = computed(
  () => /^\d{1,10}$/.test(rqe.value.numero) && !!rqe.value.uf && rqe.value.especialidade > 0,
);
const assOk = computed(() =>
  ass.value.tipo === 'imagem'
    ? imagem.value !== null
    : /^[0-9A-Fa-f:\s]{1,90}$/.test(ass.value.numeroSerie) &&
      !!ass.value.titular.trim() &&
      (!ass.value.impressaoDigital || /^[0-9A-Fa-f:\s]{64,95}$/.test(ass.value.impressaoDigital)),
);
const regimes = computed(() => (fiscal.value.tipoRecebedor === 'pessoa_juridica' ? REGIMES_PJ : REGIMES_PF));
watch(regimes, (r) => {
  if (!r.includes(fiscal.value.regime)) fiscal.value.regime = r[0]!;
});
const issFora = computed(() => {
  const v = fiscal.value.aliquotaIss;
  if (v === '') return false;
  const n = Number(String(v).replace(',', '.'));
  return fiscal.value.regime === 'isento' ? n !== 0 : !(n >= 2 && n <= 5);
});
const pisFalta = computed(
  () => fiscal.value.tipoRecebedor === 'pessoa_fisica' && fiscal.value.retemInss && !fiscal.value.pisPasep,
);
const fiscalOk = computed(
  () =>
    !!fiscal.value.vigenciaInicio &&
    (fiscal.value.tipoRecebedor === 'pessoa_fisica' || fiscal.value.pessoaJuridica > 0) &&
    (!fiscal.value.retemIss || fiscal.value.aliquotaIss !== '') &&
    (!fiscal.value.retemInss || fiscal.value.percentualInss !== '') &&
    !issFora.value &&
    !pisFalta.value,
);
const temConta = computed(() => conta.value.banco > 0 && !!conta.value.agencia && !!conta.value.numeroConta);
const contaOk = computed(
  () =>
    (temConta.value || (!!conta.value.tipoChavePix && !!conta.value.chavePix)) &&
    !!conta.value.favorecidoNome.trim() &&
    /^\d{11}$|^\d{14}$/.test(conta.value.favorecidoDocumento.replace(/\D+/g, '')),
);

async function gravarRqe() {
  if (
    await agir(
      () => incluirRqe(props.idProfissional, { ...rqe.value, dataRegistro: rqe.value.dataRegistro || null }),
      T('gravado'),
    )
  )
    rqe.value = { numero: '', uf: rqe.value.uf, especialidade: 0, dataRegistro: '' };
}
async function gravarAssinatura() {
  const a = ass.value;
  const img = imagem.value;
  const enviar =
    a.tipo === 'imagem' && img
      ? () =>
          enviarImagemAssinatura(props.idProfissional, {
            conteudo: img.conteudo,
            nomeOriginal: img.nome,
            usoTiss: a.usoTiss,
            vigenciaInicio: a.vigenciaInicio,
          })
      : () => incluirAssinatura(props.idProfissional, { ...a, arquivo: null });
  if (await agir(enviar, T('gravado'))) {
    ass.value = { ...ass.value, numeroSerie: '', impressaoDigital: '' };
    imagem.value = null;
  }
}
async function gravarFiscal() {
  const f = fiscal.value;
  await agir(
    () =>
      gravarDadoFiscal(props.idProfissional, {
        ...f,
        estabelecimento: f.estabelecimento || null,
        categoriaSefip: f.categoriaSefip === '' ? null : Number(f.categoriaSefip),
        pessoaJuridica: f.tipoRecebedor === 'pessoa_juridica' ? f.pessoaJuridica : null,
        aliquotaIss: f.aliquotaIss === '' ? null : f.aliquotaIss,
        percentualInss: f.percentualInss === '' ? null : f.percentualInss,
      }),
    T('gravado'),
  );
}
async function gravarConta() {
  const c = conta.value;
  if (
    await agir(
      () =>
        incluirConta(props.idProfissional, {
          ...c,
          banco: c.banco || null,
          tipoConta: c.tipoConta || null,
          tipoChavePix: c.tipoChavePix || null,
          chavePix: c.chavePix || null,
        }),
      T('gravado'),
    )
  )
    conta.value = {
      ...conta.value,
      agencia: '',
      numeroConta: '',
      contaDigito: '',
      chavePix: '',
      confirmaTerceiro: false,
    };
}
const periodo = (i: string, f: string | null) => t('complementoProfissional.periodo', { i, f: f ?? '…' });
const impostos = (f: {
  aliquotaIss: number | null;
  retemIss: boolean;
  percentualInss: number | null;
  retemInss: boolean;
}) =>
  t('complementoProfissional.fiscal.resumo', {
    iss: f.aliquotaIss ?? '—',
    inss: f.percentualInss ?? '—',
    ri: f.retemIss ? T('fiscal.retido') : '',
    rn: f.retemInss ? T('fiscal.retido') : '',
  });
const mascara = (doc: string) => (doc.length > 4 ? `${'•'.repeat(doc.length - 4)}${doc.slice(-4)}` : doc);
</script>

<template>
  <section class="cartao" aria-labelledby="compl-titulo" data-testid="complemento-profissional">
    <h2 id="compl-titulo" class="cartao__titulo">{{ T('titulo') }}</h2>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" class="ok">{{ mensagem }}</p>

    <!-- RQE -->
    <h3>{{ T('rqe.titulo') }}</h3>
    <table v-if="comp?.rqes.length" data-testid="lista-rqe">
      <thead>
        <tr>
          <th>{{ T('rqe.numero') }}</th>
          <th>{{ T('rqe.uf') }}</th>
          <th>{{ T('rqe.especialidade') }}</th>
          <th>{{ T('rqe.data') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in comp.rqes" :key="r.id" :class="{ inativo: !r.ativo }">
          <td>{{ r.numero }}</td>
          <td>{{ r.conselho ? `${r.conselho}/` : '' }}{{ r.uf }}</td>
          <td>{{ r.especialidadeDescricao }}</td>
          <td>{{ r.dataRegistro ?? '—' }}</td>
          <td>
            <button v-if="r.ativo && podeEditar" type="button" @click="encerrar('rqes', r.id, r.versao)">
              {{ T('inativar') }}
            </button>
            <span v-else-if="!r.ativo">{{ T('inativo') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ T('nenhum') }}</p>
    <form v-if="podeEditar" class="linha" data-testid="form-rqe" @submit.prevent="gravarRqe">
      <label
        >{{ T('rqe.numero') }} <input v-model.trim="rqe.numero" inputmode="numeric" maxlength="10"
      /></label>
      <SanteSelecao
        v-model="rqe.uf"
        :rotulo="T('rqe.uf')"
        :opcoes="[
          { valor: '', rotulo: '—', desabilitada: true },
          ...ufs.map((u) => ({ valor: u, rotulo: u })),
        ]"
      />
      <SanteSelecao
        v-model="rqe.especialidade"
        :rotulo="T('rqe.especialidade')"
        :opcoes="[
          { valor: 0, rotulo: '—', desabilitada: true },
          ...(opcoes?.especialidades ?? []).map((e) => ({ valor: e.id, rotulo: e.texto })),
        ]"
      />
      <label>{{ T('rqe.data') }} <input v-model="rqe.dataRegistro" type="date" :max="hoje" /></label>
      <button type="submit" :disabled="!rqeOk">{{ T('gravar') }}</button>
      <small>{{ T('rqe.dicaRegistro') }}</small>
    </form>

    <!-- Assinatura -->
    <h3>{{ T('assinatura.titulo') }}</h3>
    <table v-if="comp?.assinaturas.length" data-testid="lista-assinatura">
      <tbody>
        <tr v-for="a in comp.assinaturas" :key="a.id" :class="{ inativo: !a.vigente }">
          <td>{{ T(`assinatura.tipos.${a.tipo}`) }}</td>
          <td>{{ a.tipo === 'imagem' ? `#${a.arquivo}` : `${a.titular ?? ''} · ${a.numeroSerie ?? ''}` }}</td>
          <td>{{ periodo(a.vigenciaInicio, a.vigenciaFim) }}</td>
          <td>{{ a.vigente ? T('vigente') : T('encerrado') }}</td>
          <td>
            <button
              v-if="a.ativo && !a.vigenciaFim && podeEditar"
              type="button"
              @click="encerrar('assinaturas', a.id, a.versao)"
            >
              {{ T('encerrar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ T('nenhum') }}</p>
    <form v-if="podeEditar" class="linha" data-testid="form-assinatura" @submit.prevent="gravarAssinatura">
      <SanteSelecao
        v-model="ass.tipo"
        :rotulo="T('assinatura.tipo')"
        :opcoes="[
          { valor: 'certificado_digital', rotulo: T('assinatura.tipos.certificado_digital') },
          { valor: 'imagem', rotulo: T('assinatura.tipos.imagem') },
        ]"
      />
      <template v-if="ass.tipo === 'imagem'">
        <label
          >{{ T('assinatura.arquivo') }}
          <input
            type="file"
            accept="image/png,image/jpeg"
            data-testid="arquivo-assinatura"
            @change="escolherImagem"
        /></label>
        <small v-if="imagemErro" class="erro">{{ imagemErro }}</small>
      </template>
      <template v-else>
        <label>{{ T('assinatura.titular') }} <input v-model="ass.titular" maxlength="150" /></label>
        <label>{{ T('assinatura.serie') }} <input v-model.trim="ass.numeroSerie" maxlength="90" /></label>
        <label>{{ T('assinatura.emissor') }} <input v-model="ass.emissor" maxlength="150" /></label>
        <label
          >{{ T('assinatura.impressao') }} <input v-model.trim="ass.impressaoDigital" maxlength="95"
        /></label>
      </template>
      <label class="marca"
        ><input v-model="ass.usoTiss" type="checkbox" /> {{ T('assinatura.usoTiss') }}</label
      >
      <label>{{ T('inicio') }} <input v-model="ass.vigenciaInicio" type="date" /></label>
      <button type="submit" :disabled="!assOk">{{ T('gravar') }}</button>
      <small>{{ T('assinatura.dicaUma') }}</small>
    </form>

    <!-- Fiscal e contas: só o cargo do repasse -->
    <p v-if="!podeVerFinanceiro" class="dica">{{ T('fiscal.semAcesso') }}</p>
    <template v-else>
      <h3>{{ T('fiscal.titulo') }}</h3>
      <table v-if="fin?.fiscais.length" data-testid="lista-fiscal">
        <tbody>
          <tr v-for="f in fin.fiscais" :key="f.id" :class="{ inativo: !f.vigente }">
            <td>{{ periodo(f.vigenciaInicio, f.vigenciaFim) }}</td>
            <td>{{ f.estabelecimentoNome ?? T('fiscal.todos') }}</td>
            <td>{{ T(`fiscal.recebedores.${f.tipoRecebedor}`) }}{{ f.empresa ? ` · ${f.empresa}` : '' }}</td>
            <td>{{ f.regime ? T(`fiscal.regimes.${f.regime}`) : '—' }}</td>
            <td>{{ impostos(f) }}</td>
            <td>
              <button
                v-if="!f.vigenciaFim && podeEditarFinanceiro"
                type="button"
                @click="encerrar('dados-fiscais', f.id, f.versao)"
              >
                {{ T('encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ T('nenhum') }}</p>
      <form
        v-if="podeEditarFinanceiro"
        class="linha"
        data-testid="form-fiscal"
        @submit.prevent="gravarFiscal"
      >
        <SanteSelecao
          v-model="fiscal.estabelecimento"
          :rotulo="T('fiscal.estabelecimento')"
          :opcoes="[
            { valor: 0, rotulo: T('fiscal.todos') },
            ...(opcoes?.estabelecimentos ?? []).map((e) => ({ valor: e.id, rotulo: e.texto })),
          ]"
        />
        <label>{{ T('inicio') }} <input v-model="fiscal.vigenciaInicio" type="date" /></label>
        <SanteSelecao
          v-model="fiscal.tipoRecebedor"
          :rotulo="T('fiscal.recebedor')"
          :opcoes="[
            { valor: 'pessoa_fisica', rotulo: T('fiscal.recebedores.pessoa_fisica') },
            { valor: 'pessoa_juridica', rotulo: T('fiscal.recebedores.pessoa_juridica') },
          ]"
        />
        <template v-if="fiscal.tipoRecebedor === 'pessoa_juridica'">
          <label>{{ T('fiscal.empresa') }} <input v-model="buscaEmpresa" /></label>
          <SanteSelecao
            v-model="fiscal.pessoaJuridica"
            :rotulo="T('fiscal.empresa')"
            ocultar-rotulo
            :opcoes="[
              { valor: 0, rotulo: '—', desabilitada: true },
              ...(opcoes?.empresas ?? []).map((e) => ({ valor: e.id, rotulo: e.texto })),
            ]"
          />
        </template>
        <SanteSelecao
          v-model="fiscal.regime"
          :rotulo="T('fiscal.regime')"
          :opcoes="regimes.map((r) => ({ valor: r, rotulo: T(`fiscal.regimes.${r}`) }))"
        />
        <label
          >{{ T('fiscal.pis') }}
          <input
            v-model.trim="fiscal.pisPasep"
            inputmode="numeric"
            maxlength="14"
            :aria-invalid="pisFalta"
            :title="pisFalta ? T('fiscal.pisObrigatorio') : ''"
        /></label>
        <label
          >{{ T('fiscal.inscricaoInss') }} <input v-model.trim="fiscal.inscricaoInss" maxlength="15"
        /></label>
        <label
          >{{ T('fiscal.categoria') }}
          <input v-model.trim="fiscal.categoriaSefip" inputmode="numeric" maxlength="3"
        /></label>
        <label
          >{{ T('fiscal.inscricaoMunicipal') }}
          <input v-model.trim="fiscal.inscricaoMunicipal" maxlength="20"
        /></label>
        <label
          >{{ T('fiscal.iss') }}
          <input
            v-model="fiscal.aliquotaIss"
            inputmode="decimal"
            :aria-invalid="issFora"
            :title="issFora ? T('fiscal.issFora') : ''"
        /></label>
        <label>{{ T('fiscal.inss') }} <input v-model="fiscal.percentualInss" inputmode="decimal" /></label>
        <label class="marca"
          ><input v-model="fiscal.retemIss" type="checkbox" /> {{ T('fiscal.retemIss') }}</label
        >
        <label class="marca"
          ><input v-model="fiscal.retemInss" type="checkbox" /> {{ T('fiscal.retemInss') }}</label
        >
        <label class="marca"
          ><input v-model="fiscal.retemIrrf" type="checkbox" /> {{ T('fiscal.retemIrrf') }}</label
        >
        <label class="marca"
          ><input v-model="fiscal.retemPisCofinsCsll" type="checkbox" /> {{ T('fiscal.retemPcc') }}</label
        >
        <label
          >{{ T('fiscal.dependentes') }}
          <input v-model.number="fiscal.dependentesIrrf" type="number" min="0" max="99"
        /></label>
        <SanteSelecao
          v-model="fiscal.incidencia"
          :rotulo="T('fiscal.incidencia')"
          :opcoes="[
            { valor: 'pagamento', rotulo: T('fiscal.incidencias.pagamento') },
            { valor: 'producao', rotulo: T('fiscal.incidencias.producao') },
          ]"
        />
        <button type="submit" :disabled="!fiscalOk">{{ T('gravar') }}</button>
        <small>{{ T('fiscal.dicaVigencia') }}</small>
      </form>

      <h3>{{ T('conta.titulo') }}</h3>
      <table v-if="fin?.contas.length" data-testid="lista-contas">
        <tbody>
          <tr v-for="c in fin.contas" :key="c.id" :class="{ inativo: !c.ativo }">
            <td>
              {{ c.bancoDescricao ? `${c.bancoDescricao} · ag. ${c.agencia} · cc ${c.numeroConta}` : '' }}
              {{ c.chavePix ? `${T(`conta.tiposChave.${c.tipoChavePix}`)}: ${c.chavePix}` : '' }}
            </td>
            <td>{{ c.favorecidoNome }} ({{ mascara(c.favorecidoDocumento) }})</td>
            <td>{{ c.principal ? T('principal') : c.ativo ? '' : T('inativo') }}</td>
            <td>
              <button
                v-if="c.ativo && podeEditarFinanceiro"
                type="button"
                @click="encerrar('contas', c.id, c.versao)"
              >
                {{ T('inativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ T('nenhum') }}</p>
      <form v-if="podeEditarFinanceiro" class="linha" data-testid="form-conta" @submit.prevent="gravarConta">
        <SanteSelecao
          v-model="conta.banco"
          :rotulo="T('conta.banco')"
          :opcoes="[
            { valor: 0, rotulo: '—' },
            ...(opcoes?.bancos ?? []).map((b) => ({ valor: b.id, rotulo: b.texto })),
          ]"
        />
        <SanteSelecao
          v-model="conta.tipoConta"
          :rotulo="T('conta.tipoConta')"
          :opcoes="[
            { valor: 0, rotulo: '—' },
            ...(opcoes?.tiposConta ?? []).map((b) => ({ valor: b.id, rotulo: b.texto })),
          ]"
        />
        <label
          >{{ T('conta.agencia') }} <input v-model.trim="conta.agencia" inputmode="numeric" maxlength="10"
        /></label>
        <label
          >{{ T('conta.numero') }} <input v-model.trim="conta.numeroConta" inputmode="numeric" maxlength="20"
        /></label>
        <label
          >{{ T('conta.digito') }} <input v-model.trim="conta.contaDigito" maxlength="2" size="2"
        /></label>
        <SanteSelecao
          v-model="conta.tipoChavePix"
          :rotulo="T('conta.tipoChave')"
          :opcoes="[
            { valor: '', rotulo: '—' },
            ...['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'].map((k) => ({
              valor: k,
              rotulo: T(`conta.tiposChave.${k}`),
            })),
          ]"
        />
        <label v-if="conta.tipoChavePix"
          >{{ T('conta.chave') }} <input v-model.trim="conta.chavePix" maxlength="77"
        /></label>
        <label>{{ T('conta.favorecido') }} <input v-model="conta.favorecidoNome" maxlength="150" /></label>
        <SanteSelecao
          v-model="conta.favorecidoTipo"
          :rotulo="T('conta.favorecidoTipo')"
          :opcoes="[
            { valor: 'fisica', rotulo: T('conta.favorecidoTipos.fisica') },
            { valor: 'juridica', rotulo: T('conta.favorecidoTipos.juridica') },
          ]"
        />
        <label
          >{{ T('conta.documento') }} <input v-model.trim="conta.favorecidoDocumento" inputmode="numeric"
        /></label>
        <label class="marca"
          ><input v-model="conta.principal" type="checkbox" /> {{ T('conta.tornarPrincipal') }}</label
        >
        <label class="marca"
          ><input v-model="conta.confirmaTerceiro" type="checkbox" /> {{ T('conta.confirmaTerceiro') }}</label
        >
        <button type="submit" :disabled="!contaOk">{{ T('gravar') }}</button>
        <small v-if="!temConta && !conta.chavePix">{{ T('conta.semMeio') }}</small>
      </form>
    </template>
  </section>
</template>

<style scoped>
h3 {
  margin: 1rem 0 0.4rem;
  font-size: 1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid var(--sgh-borda);
  text-align: left;
}
.inativo {
  opacity: 0.6;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin-top: 0.5rem;
}
.linha label {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
}
.linha label.marca {
  flex-direction: row;
  gap: 0.3rem;
  align-items: center;
}
.linha small,
.dica {
  flex-basis: 100%;
  color: var(--sgh-texto-secundario);
}
.ok {
  color: var(--sgh-sucesso);
}
</style>
