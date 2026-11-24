<script setup lang="ts">
// Favorecidos do repasse e prestadores terceiros (F3.7, 06-FAT linha 46): `/repasse/favorecidos`. Visão por médico: a
// busca escolhe o médico e a tela mostra, de uma vez, o histórico dos favorecidos (vigentes primeiro), a soma das
// partes vigentes e o formulário de inclusão no mesmo lugar (tipo, favorecido pela busca, conta de crédito do médico,
// parte e início), com a soma conferida na hora. Incluir do mesmo tipo encerra o anterior no dia de antes (o servidor
// grava as duas coisas na mesma transação). Abaixo, os prestadores terceiros com a inclusão em linha (CPF/CNPJ e CNES
// conferidos ao digitar) e a inativação sem apagar. As ações aparecem só com a permissão de manter cooperativas.
import { cnpjValido, cpfValido } from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import {
  type AlvoFavorecido,
  alterarPrestadorTerceiro,
  encerrarFavorecido,
  incluirFavorecido,
  incluirPrestadorTerceiro,
  lerAlvos,
  lerContas,
  lerFavorecidos,
  lerPrestadoresTerceiros,
  type TipoFavorecido,
} from '../api-favorecidos.js';
import { data, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const podeEditar = computed(() => tem('repasse.cooperativa.editar'));
const hoje = computed(() => apoio.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

// ── Favorecidos do médico ──
const medico = ref('');
const registro = ref('');
const profissional = computed(() => Number(medico.value) || 0);
const favorecidos = useQuery({
  queryKey: computed(() => ['repasse', 'favorecidos', profissional.value]),
  queryFn: () => lerFavorecidos(profissional.value),
  enabled: computed(() => profissional.value > 0),
});
const contas = useQuery({
  queryKey: computed(() => ['repasse', 'favorecidos-contas', profissional.value]),
  queryFn: () => lerContas(profissional.value),
  enabled: computed(() => profissional.value > 0),
});
const vigenteEm = (f: { inicio: string; fim: string | null }, dia: string) =>
  f.inicio <= dia && (f.fim === null || f.fim >= dia);
const ordenados = computed(() =>
  [...(favorecidos.data.value ?? [])].sort(
    (a, b) =>
      Number(vigenteEm(b, hoje.value)) - Number(vigenteEm(a, hoje.value)) || b.inicio.localeCompare(a.inicio),
  ),
);
const form = reactive({
  tipo: 'proprio_profissional' as TipoFavorecido,
  alvo: 0,
  conta: '',
  percentual: 100,
  inicio: '',
});
watch(hoje, (h) => (form.inicio ||= h), { immediate: true });
watch(
  () => form.tipo,
  () => {
    form.alvo = 0;
    alvos.value = [];
  },
);
// A soma das partes que valerão no início escolhido, já sem o anterior do mesmo tipo (que o novo encerra).
const somaNoInicio = computed(() =>
  (favorecidos.data.value ?? [])
    .filter((f) => vigenteEm(f, form.inicio) && !(f.tipo === form.tipo && f.fontePagadora === null))
    .reduce((s, f) => s + f.percentual, 0),
);
const somaComNovo = computed(() => somaNoInicio.value + Number(form.percentual || 0));
const formValido = computed(
  () =>
    profissional.value > 0 &&
    form.inicio !== '' &&
    form.percentual > 0 &&
    somaComNovo.value <= 100 &&
    (form.tipo === 'proprio_profissional' || form.alvo > 0),
);
const termoAlvo = ref('');
const alvos = ref<AlvoFavorecido[]>([]);
async function buscarAlvo() {
  if (form.tipo === 'proprio_profissional') return;
  erro.value = null;
  try {
    alvos.value = await lerAlvos(form.tipo, termoAlvo.value.trim());
  } catch (e) {
    erro.value = e;
  }
}
async function incluir() {
  erro.value = null;
  mensagem.value = null;
  const alvo = form.tipo === 'proprio_profissional' ? null : form.alvo;
  try {
    const r = await incluirFavorecido({
      profissional: profissional.value,
      tipo: form.tipo,
      pessoaJuridica: form.tipo === 'pessoa_juridica' ? alvo : null,
      cooperativa: form.tipo === 'cooperativa' ? alvo : null,
      terceiroProfissional: form.tipo === 'terceiro_profissional' ? alvo : null,
      contaBancaria: Number(form.conta) || null,
      percentual: Number(form.percentual),
      inicio: form.inicio,
    });
    mensagem.value = r.encerrados.length
      ? t('repasse.favorecidos.incluidoEncerrou')
      : t('repasse.favorecidos.incluido');
    await qc.invalidateQueries({ queryKey: ['repasse', 'favorecidos'] });
  } catch (e) {
    erro.value = e;
  }
}
async function encerrar(id: number, versao: number) {
  erro.value = null;
  mensagem.value = null;
  try {
    await encerrarFavorecido(id, versao, hoje.value);
    mensagem.value = t('repasse.favorecidos.encerradoOk');
    await qc.invalidateQueries({ queryKey: ['repasse', 'favorecidos'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Prestadores terceiros ──
const busca = ref('');
const buscaAplicada = ref('');
const prestadores = useQuery({
  queryKey: computed(() => ['repasse', 'prestadores-terceiros', buscaAplicada.value]),
  queryFn: () => lerPrestadoresTerceiros(buscaAplicada.value),
});
const novo = reactive({
  codigo: '',
  nome: '',
  tipoPessoa: 'juridica' as 'fisica' | 'juridica',
  documento: '',
  cnes: '',
  percentual: '' as string | number,
  base: 'cobrado' as 'cobrado' | 'recebido' | 'misto',
});
const digitos = (s: string) => s.replace(/\D/g, '');
const docOk = computed(() =>
  novo.tipoPessoa === 'fisica' ? cpfValido(digitos(novo.documento)) : cnpjValido(digitos(novo.documento)),
);
const cnesOk = computed(() => novo.cnes === '' || /^\d{7}$/.test(novo.cnes));
const novoValido = computed(
  () => novo.codigo.trim() !== '' && novo.nome.trim().length >= 3 && docOk.value && cnesOk.value,
);
async function incluirPrestador() {
  erro.value = null;
  mensagem.value = null;
  try {
    await incluirPrestadorTerceiro({
      codigo: novo.codigo.trim(),
      nome: novo.nome.trim(),
      tipoPessoa: novo.tipoPessoa,
      cpf: novo.tipoPessoa === 'fisica' ? digitos(novo.documento) : null,
      cnpj: novo.tipoPessoa === 'juridica' ? digitos(novo.documento) : null,
      cnes: novo.cnes || null,
      percentualRepasse: novo.percentual === '' ? null : Number(novo.percentual),
      baseRepasse: novo.base,
    });
    mensagem.value = t('repasse.favorecidos.prestadorIncluido');
    Object.assign(novo, { codigo: '', nome: '', documento: '', cnes: '', percentual: '' });
    await qc.invalidateQueries({ queryKey: ['repasse', 'prestadores-terceiros'] });
  } catch (e) {
    erro.value = e;
  }
}
async function alternarAtivo(id: number, versao: number, ativo: boolean) {
  erro.value = null;
  try {
    await alterarPrestadorTerceiro(id, { versao, ativo });
    await qc.invalidateQueries({ queryKey: ['repasse', 'prestadores-terceiros'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="fv-titulo" data-testid="tela-rep-favorecidos">
    <h1 id="fv-titulo">{{ t('repasse.favorecidos.titulo') }}</h1>
    <p class="secundario">{{ t('repasse.favorecidos.resumo') }}</p>
    <div class="filtros acoes">
      <BuscaPrestador
        v-model="medico"
        v-model:registro="registro"
        :rotulo="t('repasse.favorecidos.medico')"
        testid="fv-medico"
      />
    </div>

    <template v-if="profissional">
      <h2>{{ t('repasse.favorecidos.doMedico') }}</h2>
      <table v-if="ordenados.length" class="tabela" data-testid="fv-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.favorecidos.tipo') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.alvo') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.fonte') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.parte') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.inicio') }}</th>
            <th scope="col">{{ t('repasse.favorecidos.fim') }}</th>
            <th scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="f in ordenados"
            :key="f.id"
            :class="{ secundario: !vigenteEm(f, hoje) }"
            :data-testid="`fv-linha-${f.id}`"
          >
            <td>{{ t(`repasse.favorecidos.tipos.${f.tipo}`) }}</td>
            <td>{{ f.alvoNome ?? f.profissionalNome }}</td>
            <td>{{ f.fontePagadoraNome ?? t('repasse.favorecidos.todasFontes') }}</td>
            <td>{{ f.percentual }}</td>
            <td>{{ data(f.inicio) }}</td>
            <td>{{ f.fim ? data(f.fim) : t('repasse.favorecidos.vigente') }}</td>
            <td>
              <button
                v-if="podeEditar && f.fim === null"
                type="button"
                :data-testid="`fv-encerrar-${f.id}`"
                @click="encerrar(f.id, f.versao)"
              >
                {{ t('repasse.favorecidos.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.nenhum') }}</p>

      <fieldset v-if="podeEditar" data-testid="fv-novo">
        <legend>{{ t('repasse.favorecidos.incluir') }}</legend>
        <div class="filtros acoes">
          <span class="campo">
            <label for="fv-tipo">{{ t('repasse.favorecidos.tipo') }}</label>
            <select id="fv-tipo" v-model="form.tipo" data-testid="fv-tipo">
              <option
                v-for="(r, k) in {
                  proprio_profissional: 1,
                  pessoa_juridica: 1,
                  cooperativa: 1,
                  terceiro_profissional: 1,
                }"
                :key="k"
                :value="k"
              >
                {{ t(`repasse.favorecidos.tipos.${k}`) }}
              </option>
            </select>
          </span>
          <template v-if="form.tipo !== 'proprio_profissional'">
            <span class="campo">
              <label for="fv-busca-alvo">{{ t('repasse.favorecidos.buscarAlvo') }}</label>
              <input
                id="fv-busca-alvo"
                v-model="termoAlvo"
                data-testid="fv-busca-alvo"
                @keyup.enter="buscarAlvo"
              />
            </span>
            <button type="button" data-testid="fv-buscar-alvo" @click="buscarAlvo">
              {{ t('repasse.buscar') }}
            </button>
            <span class="campo">
              <label for="fv-alvo">{{ t('repasse.favorecidos.alvo') }}</label>
              <select id="fv-alvo" v-model.number="form.alvo" data-testid="fv-alvo">
                <option :value="0">—</option>
                <option v-for="a in alvos" :key="a.id" :value="a.id">
                  {{ a.nome }}{{ a.documento ? ` · ${a.documento}` : '' }}
                </option>
              </select>
            </span>
          </template>
          <span class="campo">
            <label for="fv-conta">{{ t('repasse.favorecidos.conta') }}</label>
            <select id="fv-conta" v-model="form.conta" data-testid="fv-conta">
              <option value="">{{ t('repasse.favorecidos.semConta') }}</option>
              <option v-for="c in contas.data.value ?? []" :key="c.id" :value="String(c.id)">
                {{
                  t('repasse.favorecidos.contaRotulo', {
                    rotulo: c.rotulo,
                    titular: c.titular,
                    final: c.documentoFinal,
                  })
                }}
              </option>
            </select>
          </span>
          <span class="campo">
            <label for="fv-parte">{{ t('repasse.favorecidos.parte') }}</label>
            <input
              id="fv-parte"
              v-model.number="form.percentual"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              data-testid="fv-parte"
            />
          </span>
          <span class="campo">
            <label for="fv-inicio">{{ t('repasse.favorecidos.inicio') }}</label>
            <input id="fv-inicio" v-model="form.inicio" type="date" data-testid="fv-inicio" />
          </span>
          <button type="button" :disabled="!formValido" data-testid="fv-incluir" @click="incluir">
            {{ t('repasse.favorecidos.incluir') }}
          </button>
        </div>
        <p :role="somaComNovo > 100 ? 'alert' : 'note'" data-testid="fv-soma">
          {{
            somaComNovo > 100
              ? t('repasse.favorecidos.somaPassa', { soma: somaComNovo.toFixed(2) })
              : t('repasse.favorecidos.somaVigente', { soma: somaComNovo.toFixed(2) })
          }}
        </p>
      </fieldset>
    </template>

    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="fv-mensagem" />

    <h2>{{ t('repasse.favorecidos.prestadores') }}</h2>
    <div class="filtros acoes">
      <span class="campo">
        <label for="pt-busca">{{ t('repasse.favorecidos.buscarPrestador') }}</label>
        <input id="pt-busca" v-model="busca" data-testid="pt-busca" @keyup.enter="buscaAplicada = busca" />
      </span>
      <button type="button" data-testid="pt-buscar" @click="buscaAplicada = busca">
        {{ t('repasse.buscar') }}
      </button>
    </div>
    <ErroFaturamento v-if="prestadores.error.value" :erro="prestadores.error.value" />
    <table v-if="prestadores.data.value?.length" class="tabela" data-testid="pt-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.favorecidos.codigo') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.nome') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.documento') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.cnes') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.percentual') }}</th>
          <th scope="col">{{ t('repasse.favorecidos.base') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="p in prestadores.data.value"
          :key="p.id"
          :class="{ secundario: !p.ativo }"
          :data-testid="`pt-linha-${p.codigo}`"
        >
          <td>{{ p.codigo }}</td>
          <td>{{ p.nome }}</td>
          <td>{{ p.cnpj ?? p.cpf }}</td>
          <td>{{ p.cnes ?? '' }}</td>
          <td>{{ p.percentualRepasse ?? '' }}</td>
          <td>{{ t(`repasse.favorecidos.bases.${p.baseRepasse}`) }}</td>
          <td>
            <span v-if="!p.ativo && p.inativadoEm">{{
              t('repasse.favorecidos.inativo', { data: data(p.inativadoEm) })
            }}</span>
            <button
              v-if="podeEditar"
              type="button"
              :data-testid="`pt-ativo-${p.codigo}`"
              @click="alternarAtivo(p.id, p.versao, !p.ativo)"
            >
              {{ p.ativo ? t('repasse.favorecidos.inativar') : t('repasse.favorecidos.reativar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>

    <fieldset v-if="podeEditar" data-testid="pt-novo">
      <legend>{{ t('repasse.favorecidos.incluirPrestador') }}</legend>
      <div class="filtros acoes">
        <span class="campo">
          <label for="pt-codigo">{{ t('repasse.favorecidos.codigo') }}</label>
          <input id="pt-codigo" v-model="novo.codigo" maxlength="30" data-testid="pt-codigo" />
        </span>
        <span class="campo">
          <label for="pt-nome">{{ t('repasse.favorecidos.nome') }}</label>
          <input id="pt-nome" v-model="novo.nome" maxlength="150" data-testid="pt-nome" />
        </span>
        <span class="campo">
          <label for="pt-pessoa">{{ t('repasse.favorecidos.tipoPessoa') }}</label>
          <select id="pt-pessoa" v-model="novo.tipoPessoa" data-testid="pt-pessoa">
            <option value="juridica">{{ t('repasse.favorecidos.juridica') }}</option>
            <option value="fisica">{{ t('repasse.favorecidos.fisica') }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="pt-doc">{{ t('repasse.favorecidos.documento') }}</label>
          <input
            id="pt-doc"
            v-model="novo.documento"
            :aria-invalid="novo.documento !== '' && !docOk"
            data-testid="pt-documento"
          />
          <small v-if="novo.documento !== '' && !docOk" role="alert">{{
            t('repasse.favorecidos.documentoInvalido')
          }}</small>
        </span>
        <span class="campo">
          <label for="pt-cnes">{{ t('repasse.favorecidos.cnes') }}</label>
          <input
            id="pt-cnes"
            v-model="novo.cnes"
            maxlength="7"
            :aria-invalid="!cnesOk"
            data-testid="pt-cnes"
          />
          <small v-if="!cnesOk" role="alert">{{ t('repasse.favorecidos.cnesInvalido') }}</small>
        </span>
        <span class="campo">
          <label for="pt-perc">{{ t('repasse.favorecidos.percentual') }}</label>
          <input
            id="pt-perc"
            v-model="novo.percentual"
            type="number"
            min="0"
            max="100"
            step="0.01"
            data-testid="pt-percentual"
          />
        </span>
        <span class="campo">
          <label for="pt-base">{{ t('repasse.favorecidos.base') }}</label>
          <select id="pt-base" v-model="novo.base" data-testid="pt-base">
            <option value="cobrado">{{ t('repasse.favorecidos.bases.cobrado') }}</option>
            <option value="recebido">{{ t('repasse.favorecidos.bases.recebido') }}</option>
            <option value="misto">{{ t('repasse.favorecidos.bases.misto') }}</option>
          </select>
        </span>
        <button type="button" :disabled="!novoValido" data-testid="pt-incluir" @click="incluirPrestador">
          {{ t('repasse.favorecidos.incluirPrestador') }}
        </button>
      </div>
    </fieldset>
  </section>
</template>

<style src="../estilo-repasse.css"></style>
