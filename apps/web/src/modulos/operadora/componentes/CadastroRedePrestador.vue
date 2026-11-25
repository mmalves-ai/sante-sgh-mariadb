<script setup lang="ts">
// Cadastro complementar do prestador na ficha da rede credenciada (08-SGO L101, C2-118): locais de atendimento,
// especialidades atendidas por local, qualificação divulgada, suspensão temporária e o histórico do descredenciamento
// com o aviso e o substituto. Tudo na mesma ficha (sem trocar de tela); a recusa do domínio aparece na hora, junto do
// formulário, e o que for desligado ou encerrado continua na lista (nada é apagado).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  desligarLocal,
  encerrarEspecialidade,
  encerrarQualificacao,
  incluirEspecialidade,
  incluirLocal,
  incluirQualificacao,
  lerApoioCadastro,
  lerFichaCadastro,
  MOTIVOS_SUSPENSAO,
  reativarPrestador,
  SITUACOES_DESCREDENCIAMENTO,
  SITUACOES_SUSPENSAO,
  suspenderPrestador,
  TIPOS_MOTIVO_DESCREDENCIAMENTO,
} from '../api-rede-cadastro.js';

const props = defineProps<{ prestador: number; podeEditar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const chave = computed(() => ['operadora', 'rede', 'cadastro', props.prestador]);
const ficha = useQuery({ queryKey: chave, queryFn: () => lerFichaCadastro(props.prestador) });
const apoio = useQuery({
  queryKey: ['operadora', 'rede', 'cadastro', 'apoio'],
  queryFn: () => lerApoioCadastro(),
});

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const data = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const rotuloDe = <K extends string>(m: Readonly<Record<K, string>>, v: string) => m[v as K] ?? v;

const aberto = ref<'local' | 'especialidade' | 'qualificacao' | 'suspensao' | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
async function executar(fn: () => Promise<unknown>): Promise<boolean> {
  recusa.value = null;
  erro.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: chave.value });
    await cliente.invalidateQueries({ queryKey: ['operadora', 'rede'] });
    return true;
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
    return false;
  }
}
function abrir(qual: typeof aberto.value): void {
  recusa.value = null;
  erro.value = null;
  aberto.value = aberto.value === qual ? null : qual;
}

// ---- locais ----
const locaisAtivos = computed(() => (ficha.data.value?.locais ?? []).filter((l) => l.ativo));
const nomeLocal = (id: number | null) =>
  id === null
    ? 'Todos os locais'
    : (ficha.data.value?.locais.find((l) => l.id === id)?.nome ?? `Local ${id}`);
const opcoesLocal = computed(() => [
  { valor: null as number | null, rotulo: 'Todos os locais' },
  ...locaisAtivos.value.map((l) => ({
    valor: l.id as number | null,
    rotulo: l.nome ?? `${l.logradouro}, ${l.numero ?? 's/n'}`,
  })),
]);
const novoLocal = reactive({
  nome: '',
  cnes: '',
  cep: '',
  logradouro: '',
  numero: '',
  bairro: '',
  municipioIbge: '',
  telefone: '',
  email: '',
  acessivelCadeirante: false,
  estacionamento: false,
  principal: false,
  divulga: true,
});
const problemasLocal = computed(() => {
  const r: string[] = [];
  if (novoLocal.cep && !/^\d{8}$/.test(novoLocal.cep.replace(/\D/g, ''))) r.push('O CEP tem 8 dígitos.');
  if (novoLocal.cnes && !/^\d{7}$/.test(novoLocal.cnes.trim())) r.push('O CNES tem 7 dígitos.');
  if (novoLocal.municipioIbge && !/^\d{7}$/.test(novoLocal.municipioIbge.trim()))
    r.push('O município é o código do IBGE com 7 dígitos.');
  return r;
});
const localCompleto = computed(
  () =>
    problemasLocal.value.length === 0 &&
    novoLocal.cep !== '' &&
    novoLocal.logradouro.trim() !== '' &&
    novoLocal.municipioIbge !== '',
);
const ou = (v: string) => v.trim() || null;
async function gravarLocal(): Promise<void> {
  if (!localCompleto.value) return;
  const ok = await executar(() =>
    incluirLocal(props.prestador, {
      nome: ou(novoLocal.nome),
      cnes: ou(novoLocal.cnes),
      cep: novoLocal.cep,
      logradouro: novoLocal.logradouro.trim(),
      numero: ou(novoLocal.numero),
      complemento: null,
      bairro: ou(novoLocal.bairro),
      municipioIbge: Number(novoLocal.municipioIbge),
      latitude: null,
      longitude: null,
      telefone: ou(novoLocal.telefone),
      email: ou(novoLocal.email),
      acessivelCadeirante: novoLocal.acessivelCadeirante,
      estacionamento: novoLocal.estacionamento,
      principal: novoLocal.principal,
      divulga: novoLocal.divulga,
    }),
  );
  if (ok) aberto.value = null;
}
const desligando = ref<number | null>(null);
const motivoDesligamento = ref('');
const dataDesligamento = ref<string | null>(hojeLocal());
async function confirmarDesligamento(id: number, versao: number): Promise<void> {
  if (!dataDesligamento.value) return;
  const ok = await executar(() =>
    desligarLocal(id, versao, dataDesligamento.value!, motivoDesligamento.value),
  );
  if (ok) desligando.value = null;
}

// ---- especialidades ----
const opcoesEspecialidade = computed(() =>
  (apoio.data.value?.especialidades ?? []).map((e) => ({
    valor: e.id as number | null,
    rotulo: e.descricao,
  })),
);
const novaEsp = reactive({
  especialidade: null as number | null,
  local: null as number | null,
  ambulatorio: true,
  internacao: false,
  urgencia: false,
  hospitalDia: false,
  adulto: true,
  pediatrico: false,
  rqe: '',
  principal: false,
  divulga: true,
});
const problemasEsp = computed(() => {
  const r: string[] = [];
  if (!novaEsp.ambulatorio && !novaEsp.internacao && !novaEsp.urgencia && !novaEsp.hospitalDia)
    r.push('Marque ao menos um regime.');
  if (!novaEsp.adulto && !novaEsp.pediatrico) r.push('Marque o público atendido.');
  if (ficha.data.value?.prestador.pessoa === 'F' && novaEsp.divulga && !novaEsp.rqe.trim())
    r.push('Para divulgar o profissional como especialista no guia, informe o RQE.');
  return r;
});
async function gravarEspecialidade(): Promise<void> {
  if (novaEsp.especialidade === null || problemasEsp.value.length) return;
  const ok = await executar(() =>
    incluirEspecialidade(props.prestador, {
      ...novaEsp,
      especialidade: novaEsp.especialidade!,
      rqe: ou(novaEsp.rqe),
    }),
  );
  if (ok) aberto.value = null;
}
const regimes = (e: { ambulatorio: boolean; internacao: boolean; urgencia: boolean; hospitalDia: boolean }) =>
  [
    e.ambulatorio && 'Ambulatório',
    e.internacao && 'Internação',
    e.urgencia && 'Urgência',
    e.hospitalDia && 'Hospital-dia',
  ]
    .filter(Boolean)
    .join(', ');

// ---- qualificação ----
const atributosAplicaveis = computed(() => {
  const p = ficha.data.value?.prestador;
  return (apoio.data.value?.atributos ?? []).filter((a) =>
    p?.pessoa === 'F' ? a.pessoaFisica : a.pessoaJuridica || (p?.hospitalar === true && a.hospital),
  );
});
const opcoesAtributo = computed(() =>
  atributosAplicaveis.value.map((a) => ({
    valor: a.id as number | null,
    rotulo: a.sigla ? `${a.sigla} · ${a.descricao}` : a.descricao,
  })),
);
const novaQual = reactive({
  atributo: null as number | null,
  nivel: '',
  titulo: '',
  divulga: true,
  vigenciaInicio: hojeLocal() as string | null,
  vigenciaFim: null as string | null,
});
const qualInvertida = computed(
  () => !!novaQual.vigenciaFim && !!novaQual.vigenciaInicio && novaQual.vigenciaFim < novaQual.vigenciaInicio,
);
async function gravarQualificacao(): Promise<void> {
  if (novaQual.atributo === null || !novaQual.vigenciaInicio || qualInvertida.value) return;
  const ok = await executar(() =>
    incluirQualificacao(props.prestador, {
      atributo: novaQual.atributo!,
      nivel: ou(novaQual.nivel),
      titulo: ou(novaQual.titulo),
      divulga: novaQual.divulga,
      vigenciaInicio: novaQual.vigenciaInicio!,
      vigenciaFim: novaQual.vigenciaFim,
    }),
  );
  if (ok) aberto.value = null;
}

// ---- suspensão ----
const opcoesMotivo = Object.entries(MOTIVOS_SUSPENSAO).map(([valor, rotulo]) => ({
  valor: valor as keyof typeof MOTIVOS_SUSPENSAO | null,
  rotulo,
}));
const novaSusp = reactive({
  motivo: null as keyof typeof MOTIVOS_SUSPENSAO | null,
  local: null as number | null,
  desde: hojeLocal() as string | null,
  reativacaoPrevista: null as string | null,
  observacao: '',
});
const problemasSusp = computed(() => {
  const r: string[] = [];
  if (novaSusp.desde && novaSusp.desde < hojeLocal()) r.push('A suspensão vale de hoje em diante.');
  if (novaSusp.reativacaoPrevista && novaSusp.desde && novaSusp.reativacaoPrevista < novaSusp.desde)
    r.push('A reativação não pode ser antes do início.');
  if (novaSusp.motivo === 'outro' && novaSusp.observacao.trim().length < 10)
    r.push('No motivo "outro", descreva a causa (10 caracteres ou mais).');
  return r;
});
async function gravarSuspensao(): Promise<void> {
  if (!novaSusp.motivo || !novaSusp.desde || problemasSusp.value.length) return;
  const ok = await executar(() =>
    suspenderPrestador(props.prestador, {
      motivo: novaSusp.motivo!,
      local: novaSusp.local,
      desde: novaSusp.desde!,
      reativacaoPrevista: novaSusp.reativacaoPrevista,
      observacao: ou(novaSusp.observacao),
    }),
  );
  if (ok) aberto.value = null;
}
</script>

<template>
  <section class="cadastro-rede" data-testid="rede-cadastro">
    <MensagemErro v-if="ficha.error.value" :erro="ficha.error.value" />
    <template v-else-if="ficha.data.value">
      <SanteAlerta
        v-if="ficha.data.value.suspensoHoje"
        variante="alerta"
        :texto="t('operadoraRede.cadastro.suspensoHoje')"
        data-testid="rede-suspenso-hoje"
      />
      <SanteAlerta v-if="recusa" variante="alerta" :texto="recusa" data-testid="rede-cadastro-recusa" />
      <MensagemErro v-if="erro" :erro="erro" />

      <!-- Locais de atendimento -->
      <h3>{{ t('operadoraRede.cadastro.secoes.locais') }}</h3>
      <table class="tabela" data-testid="rede-locais">
        <caption class="visualmente-oculto">
          {{
            t('operadoraRede.cadastro.secoes.locais')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.local') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.endereco') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.acessibilidade') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.situacao') }}</th>
            <th v-if="podeEditar" scope="col">
              <span class="visualmente-oculto">{{ t('operadoraRede.cadastro.colunas.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in ficha.data.value.locais" :key="l.id">
            <td>
              {{ l.nome ?? t('operadoraRede.cadastro.semNome', { n: l.sequencia }) }}
              <template v-if="l.principal">{{ t('operadoraRede.cadastro.marcaPrincipal') }}</template>
              <template v-if="l.cnes">{{ t('operadoraRede.cadastro.marcaCnes', { cnes: l.cnes }) }}</template>
            </td>
            <td>
              {{
                t('operadoraRede.cadastro.endereco', {
                  logradouro: l.logradouro,
                  numero: l.numero ?? t('operadoraRede.cadastro.semNumero'),
                  cep: l.cep,
                  ibge: l.municipioIbge,
                })
              }}
            </td>
            <td>
              {{ l.acessivelCadeirante ? t('operadoraRede.cadastro.acessivel') : '—' }}
              <template v-if="l.estacionamento">{{
                t('operadoraRede.cadastro.marcaEstacionamento')
              }}</template>
            </td>
            <td>
              {{
                l.ativo
                  ? t('operadoraRede.cadastro.ativo')
                  : t('operadoraRede.cadastro.desligado', {
                      data: data(l.desligadoEm),
                      motivo: l.motivoDesligamento ?? '',
                    })
              }}
            </td>
            <td v-if="podeEditar">
              <template v-if="l.ativo">
                <div v-if="desligando === l.id" class="formulario" data-testid="rede-local-desligar-form">
                  <SanteCampoTexto
                    :id="`rede-local-motivo-${l.id}`"
                    v-model="motivoDesligamento"
                    :rotulo="t('operadoraRede.cadastro.campos.motivoDesligamento')"
                    :max-bytes="500"
                    obrigatorio
                  />
                  <SanteData
                    v-model="dataDesligamento"
                    :rotulo="t('operadoraRede.cadastro.campos.desligadoEm')"
                    editavel
                  />
                  <SanteBotao
                    :rotulo="t('operadoraRede.cadastro.acoes.confirmarDesligamento')"
                    data-testid="rede-local-desligar-confirmar"
                    @acionar="confirmarDesligamento(l.id, l.versao)"
                  />
                </div>
                <SanteBotao
                  v-else
                  variante="texto"
                  :rotulo="t('operadoraRede.cadastro.acoes.desligar')"
                  :data-testid="`rede-local-desligar-${l.id}`"
                  @acionar="desligando = l.id"
                />
              </template>
            </td>
          </tr>
          <tr v-if="!ficha.data.value.locais.length">
            <td :colspan="podeEditar ? 5 : 4">{{ t('operadoraRede.cadastro.vazio.locais') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar"
        variante="secundario"
        :rotulo="t('operadoraRede.cadastro.acoes.incluirLocal')"
        data-testid="rede-local-incluir"
        @acionar="abrir('local')"
      />
      <form
        v-if="aberto === 'local'"
        class="formulario grade"
        data-testid="rede-local-form"
        @submit.prevent="gravarLocal"
      >
        <SanteCampoTexto
          id="rede-local-nome"
          v-model="novoLocal.nome"
          :rotulo="t('operadoraRede.cadastro.campos.nomeDivulgacao')"
          :max-bytes="150"
        />
        <SanteCampoTexto
          id="rede-local-cep"
          v-model="novoLocal.cep"
          :rotulo="t('operadoraRede.cadastro.campos.cep')"
          :max-bytes="9"
          obrigatorio
        />
        <SanteCampoTexto
          id="rede-local-logradouro"
          v-model="novoLocal.logradouro"
          :rotulo="t('operadoraRede.cadastro.campos.logradouro')"
          :max-bytes="150"
          obrigatorio
        />
        <SanteCampoTexto
          id="rede-local-numero"
          v-model="novoLocal.numero"
          :rotulo="t('operadoraRede.cadastro.campos.numero')"
          :max-bytes="10"
        />
        <SanteCampoTexto
          id="rede-local-bairro"
          v-model="novoLocal.bairro"
          :rotulo="t('operadoraRede.cadastro.campos.bairro')"
          :max-bytes="100"
        />
        <SanteCampoTexto
          id="rede-local-municipio"
          v-model="novoLocal.municipioIbge"
          :rotulo="t('operadoraRede.cadastro.campos.municipio')"
          :max-bytes="7"
          obrigatorio
        />
        <SanteCampoTexto
          id="rede-local-cnes"
          v-model="novoLocal.cnes"
          :rotulo="t('operadoraRede.cadastro.campos.cnesLocal')"
          :max-bytes="7"
        />
        <SanteCampoTexto
          id="rede-local-telefone"
          v-model="novoLocal.telefone"
          :rotulo="t('operadoraRede.cadastro.campos.telefone')"
          :max-bytes="20"
        />
        <SanteCampoTexto
          id="rede-local-email"
          v-model="novoLocal.email"
          :rotulo="t('operadoraRede.cadastro.campos.email')"
          :max-bytes="254"
        />
        <label
          ><input v-model="novoLocal.acessivelCadeirante" type="checkbox" />
          {{ t('operadoraRede.cadastro.marcar.acessivel') }}</label
        >
        <label
          ><input v-model="novoLocal.estacionamento" type="checkbox" />
          {{ t('operadoraRede.cadastro.marcar.estacionamento') }}</label
        >
        <label
          ><input v-model="novoLocal.principal" type="checkbox" data-testid="rede-local-principal" />
          {{ t('operadoraRede.cadastro.marcar.principal') }}</label
        >
        <label
          ><input v-model="novoLocal.divulga" type="checkbox" />
          {{ t('operadoraRede.cadastro.marcar.divulgaRede') }}</label
        >
        <ul v-if="problemasLocal.length" class="secundario" data-testid="rede-local-problemas">
          <li v-for="p in problemasLocal" :key="p">{{ p }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="t('operadoraRede.cadastro.acoes.gravarLocal')"
          :desabilitado="!localCompleto"
          data-testid="rede-local-gravar"
        />
      </form>

      <!-- Especialidades -->
      <h3>{{ t('operadoraRede.cadastro.secoes.especialidades') }}</h3>
      <table class="tabela" data-testid="rede-especialidades">
        <caption class="visualmente-oculto">
          {{
            t('operadoraRede.cadastro.secoes.especialidades')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.especialidade') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.local') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.regimes') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.rqe') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.situacao') }}</th>
            <th v-if="podeEditar" scope="col">
              <span class="visualmente-oculto">{{ t('operadoraRede.cadastro.colunas.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in ficha.data.value.especialidades" :key="e.id">
            <td>
              {{ e.descricao
              }}<template v-if="e.principal">{{ t('operadoraRede.cadastro.marcaPrincipal') }}</template>
            </td>
            <td>{{ nomeLocal(e.local) }}</td>
            <td>{{ regimes(e) }}</td>
            <td>{{ e.rqe ?? '—' }}</td>
            <td>
              {{
                e.situacao === 'ativa'
                  ? t('operadoraRede.cadastro.ativa')
                  : t('operadoraRede.cadastro.encerrada')
              }}
            </td>
            <td v-if="podeEditar">
              <SanteBotao
                v-if="e.situacao === 'ativa'"
                variante="texto"
                :rotulo="t('operadoraRede.cadastro.acoes.encerrar')"
                :data-testid="`rede-especialidade-encerrar-${e.id}`"
                @acionar="executar(() => encerrarEspecialidade(e.id, e.versao))"
              />
            </td>
          </tr>
          <tr v-if="!ficha.data.value.especialidades.length">
            <td :colspan="podeEditar ? 6 : 5">{{ t('operadoraRede.cadastro.vazio.especialidades') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar"
        variante="secundario"
        :rotulo="t('operadoraRede.cadastro.acoes.incluirEspecialidade')"
        data-testid="rede-especialidade-incluir"
        @acionar="abrir('especialidade')"
      />
      <form
        v-if="aberto === 'especialidade'"
        class="formulario grade"
        data-testid="rede-especialidade-form"
        @submit.prevent="gravarEspecialidade"
      >
        <SanteSelecao
          v-model="novaEsp.especialidade"
          :rotulo="t('operadoraRede.cadastro.campos.especialidade')"
          :opcoes="opcoesEspecialidade"
          :busca="true"
          obrigatorio
          data-testid="rede-especialidade-campo"
        />
        <SanteSelecao
          v-model="novaEsp.local"
          :rotulo="t('operadoraRede.cadastro.campos.local')"
          :opcoes="opcoesLocal"
          data-testid="rede-especialidade-local"
        />
        <SanteCampoTexto
          id="rede-especialidade-rqe"
          v-model="novaEsp.rqe"
          :rotulo="t('operadoraRede.cadastro.campos.rqe')"
          :max-bytes="30"
        />
        <fieldset>
          <legend>{{ t('operadoraRede.cadastro.grupos.regimes') }}</legend>
          <label
            ><input v-model="novaEsp.ambulatorio" type="checkbox" />
            {{ t('operadoraRede.cadastro.marcar.ambulatorio') }}</label
          >
          <label
            ><input v-model="novaEsp.internacao" type="checkbox" />
            {{ t('operadoraRede.cadastro.marcar.internacao') }}</label
          >
          <label
            ><input v-model="novaEsp.urgencia" type="checkbox" data-testid="rede-especialidade-urgencia" />
            {{ t('operadoraRede.cadastro.marcar.urgencia') }}</label
          >
          <label
            ><input v-model="novaEsp.hospitalDia" type="checkbox" />
            {{ t('operadoraRede.cadastro.marcar.hospitalDia') }}</label
          >
        </fieldset>
        <fieldset>
          <legend>{{ t('operadoraRede.cadastro.grupos.publico') }}</legend>
          <label
            ><input v-model="novaEsp.adulto" type="checkbox" />
            {{ t('operadoraRede.cadastro.marcar.adulto') }}</label
          >
          <label
            ><input v-model="novaEsp.pediatrico" type="checkbox" />
            {{ t('operadoraRede.cadastro.marcar.pediatrico') }}</label
          >
        </fieldset>
        <label
          ><input v-model="novaEsp.divulga" type="checkbox" data-testid="rede-especialidade-divulga" />
          {{ t('operadoraRede.cadastro.marcar.divulga') }}</label
        >
        <ul v-if="problemasEsp.length" class="secundario" data-testid="rede-especialidade-problemas">
          <li v-for="p in problemasEsp" :key="p">{{ p }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="t('operadoraRede.cadastro.acoes.gravarEspecialidade')"
          :desabilitado="novaEsp.especialidade === null || problemasEsp.length > 0"
          data-testid="rede-especialidade-gravar"
        />
      </form>

      <!-- Qualificação divulgada -->
      <h3>{{ t('operadoraRede.cadastro.secoes.qualificacoes') }}</h3>
      <table class="tabela" data-testid="rede-qualificacoes">
        <caption class="visualmente-oculto">
          {{
            t('operadoraRede.cadastro.secoes.qualificacoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.atributo') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.nivel') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.validade') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.divulgadaHoje') }}</th>
            <th v-if="podeEditar" scope="col">
              <span class="visualmente-oculto">{{ t('operadoraRede.cadastro.colunas.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in ficha.data.value.qualificacoes" :key="q.id">
            <td>{{ q.codigoAtributo }} · {{ q.descricaoAtributo }}</td>
            <td>{{ q.nivel ?? '—' }}</td>
            <td>
              {{
                t('operadoraRede.cadastro.periodo', {
                  inicio: data(q.vigenciaInicio),
                  fim: q.vigenciaFim ? data(q.vigenciaFim) : t('operadoraRede.cadastro.semFim'),
                })
              }}
            </td>
            <td>{{ q.vigente ? t('operadoraRede.cadastro.sim') : t('operadoraRede.cadastro.nao') }}</td>
            <td v-if="podeEditar">
              <SanteBotao
                v-if="!q.vigenciaFim || q.vigenciaFim > hojeLocal()"
                variante="texto"
                :rotulo="t('operadoraRede.cadastro.acoes.encerrarHoje')"
                :data-testid="`rede-qualificacao-encerrar-${q.id}`"
                @acionar="executar(() => encerrarQualificacao(q.id, q.versao, hojeLocal()))"
              />
            </td>
          </tr>
          <tr v-if="!ficha.data.value.qualificacoes.length">
            <td :colspan="podeEditar ? 5 : 4">{{ t('operadoraRede.cadastro.vazio.qualificacoes') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar"
        variante="secundario"
        :rotulo="t('operadoraRede.cadastro.acoes.registrarQualificacao')"
        data-testid="rede-qualificacao-incluir"
        @acionar="abrir('qualificacao')"
      />
      <form
        v-if="aberto === 'qualificacao'"
        class="formulario grade"
        data-testid="rede-qualificacao-form"
        @submit.prevent="gravarQualificacao"
      >
        <SanteSelecao
          v-model="novaQual.atributo"
          :rotulo="t('operadoraRede.cadastro.campos.atributo')"
          :opcoes="opcoesAtributo"
          obrigatorio
          data-testid="rede-qualificacao-atributo"
        />
        <SanteCampoTexto
          id="rede-qualificacao-nivel"
          v-model="novaQual.nivel"
          :rotulo="t('operadoraRede.cadastro.campos.nivel')"
          :max-bytes="30"
        />
        <SanteCampoTexto
          id="rede-qualificacao-titulo"
          v-model="novaQual.titulo"
          :rotulo="t('operadoraRede.cadastro.campos.titulo')"
          :max-bytes="400"
        />
        <SanteData
          v-model="novaQual.vigenciaInicio"
          :rotulo="t('operadoraRede.cadastro.campos.validaDesde')"
          editavel
        />
        <SanteData
          v-model="novaQual.vigenciaFim"
          :rotulo="t('operadoraRede.cadastro.campos.validaAte')"
          editavel
        />
        <label
          ><input v-model="novaQual.divulga" type="checkbox" />
          {{ t('operadoraRede.cadastro.marcar.divulga') }}</label
        >
        <p v-if="qualInvertida" class="secundario" data-testid="rede-qualificacao-problema">
          {{ t('operadoraRede.cadastro.qualInvertida') }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('operadoraRede.cadastro.acoes.gravarQualificacao')"
          :desabilitado="novaQual.atributo === null || !novaQual.vigenciaInicio || qualInvertida"
          data-testid="rede-qualificacao-gravar"
        />
      </form>

      <!-- Suspensão -->
      <h3>{{ t('operadoraRede.cadastro.secoes.suspensoes') }}</h3>
      <table class="tabela" data-testid="rede-suspensoes">
        <caption class="visualmente-oculto">
          {{
            t('operadoraRede.cadastro.secoes.suspensoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.motivo') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.alcance') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.periodo') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.situacao') }}</th>
            <th v-if="podeEditar" scope="col">
              <span class="visualmente-oculto">{{ t('operadoraRede.cadastro.colunas.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in ficha.data.value.suspensoes" :key="s.id">
            <td>{{ rotuloDe(MOTIVOS_SUSPENSAO, s.motivo) }}</td>
            <td>
              {{ s.local === null ? t('operadoraRede.cadastro.prestadorInteiro') : nomeLocal(s.local) }}
            </td>
            <td>
              {{
                t('operadoraRede.cadastro.periodo', {
                  inicio: data(s.desde),
                  fim: s.reativadoEm ? data(s.reativadoEm) : t('operadoraRede.cadastro.semData'),
                })
              }}
            </td>
            <td>{{ rotuloDe(SITUACOES_SUSPENSAO, s.situacao) }}</td>
            <td v-if="podeEditar">
              <SanteBotao
                v-if="s.situacao === 'ativa' || s.situacao === 'programada'"
                variante="texto"
                :rotulo="
                  s.situacao === 'programada'
                    ? t('operadoraRede.cadastro.acoes.cancelar')
                    : t('operadoraRede.cadastro.acoes.reativarHoje')
                "
                :data-testid="`rede-suspensao-reativar-${s.id}`"
                @acionar="executar(() => reativarPrestador(s.id, s.versao, hojeLocal()))"
              />
            </td>
          </tr>
          <tr v-if="!ficha.data.value.suspensoes.length">
            <td :colspan="podeEditar ? 5 : 4">{{ t('operadoraRede.cadastro.vazio.suspensoes') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar && ficha.data.value.prestador.credenciado"
        variante="secundario"
        :rotulo="t('operadoraRede.cadastro.acoes.suspender')"
        data-testid="rede-suspensao-incluir"
        @acionar="abrir('suspensao')"
      />
      <form
        v-if="aberto === 'suspensao'"
        class="formulario grade"
        data-testid="rede-suspensao-form"
        @submit.prevent="gravarSuspensao"
      >
        <SanteSelecao
          v-model="novaSusp.motivo"
          :rotulo="t('operadoraRede.cadastro.campos.motivo')"
          :opcoes="opcoesMotivo"
          obrigatorio
          data-testid="rede-suspensao-motivo"
        />
        <SanteSelecao
          v-model="novaSusp.local"
          :rotulo="t('operadoraRede.cadastro.campos.alcance')"
          :opcoes="opcoesLocal"
          data-testid="rede-suspensao-local"
        />
        <SanteData
          v-model="novaSusp.desde"
          :rotulo="t('operadoraRede.cadastro.campos.suspensoDesde')"
          editavel
        />
        <SanteData
          v-model="novaSusp.reativacaoPrevista"
          :rotulo="t('operadoraRede.cadastro.campos.reativacaoPrevista')"
          editavel
        />
        <SanteCampoTexto
          id="rede-suspensao-observacao"
          v-model="novaSusp.observacao"
          :rotulo="t('operadoraRede.cadastro.campos.observacao')"
          :max-bytes="1000"
          multilinha
        />
        <ul v-if="problemasSusp.length" class="secundario" data-testid="rede-suspensao-problemas">
          <li v-for="p in problemasSusp" :key="p">{{ p }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="t('operadoraRede.cadastro.acoes.gravarSuspensao')"
          :desabilitado="!novaSusp.motivo || !novaSusp.desde || problemasSusp.length > 0"
          data-testid="rede-suspensao-gravar"
        />
      </form>

      <!-- Descredenciamentos -->
      <h3>{{ t('operadoraRede.cadastro.secoes.descredenciamentos') }}</h3>
      <table class="tabela" data-testid="rede-descredenciamentos">
        <caption class="visualmente-oculto">
          {{
            t('operadoraRede.cadastro.secoes.descredenciamentos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.motivo') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.aviso') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.saida') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.substituto') }}</th>
            <th scope="col">{{ t('operadoraRede.cadastro.colunas.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in ficha.data.value.descredenciamentos" :key="d.id">
            <td>
              {{
                t('operadoraRede.cadastro.motivoDescredenciamento', {
                  tipo: rotuloDe(TIPOS_MOTIVO_DESCREDENCIAMENTO, d.tipoMotivo),
                  motivo: d.motivo,
                })
              }}
            </td>
            <td>{{ data(d.avisoBeneficiariosEm) }}</td>
            <td>{{ data(d.efetivoEm) }}</td>
            <td>
              {{
                d.nomeSubstituto ??
                (d.autorizacaoAns
                  ? t('operadoraRede.cadastro.autorizacaoAns', { numero: d.autorizacaoAns })
                  : '—')
              }}
            </td>
            <td>{{ rotuloDe(SITUACOES_DESCREDENCIAMENTO, d.situacao) }}</td>
          </tr>
          <tr v-if="!ficha.data.value.descredenciamentos.length">
            <td colspan="5">{{ t('operadoraRede.cadastro.vazio.descredenciamentos') }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.cadastro-rede {
  display: grid;
  gap: 0.75rem;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem;
  align-items: end;
}
</style>
