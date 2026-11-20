<script setup lang="ts">
// Aba "Ficha do colaborador" (M53.6; `pessoas.esocial.gerar`, leitura auditada): os dados pessoais e contratuais que os
// eventos do trabalhador levam e que o cadastro não guarda (sexo, raça e cor, instrução, nascimento, endereço, categoria,
// CBO, jornada, contrato, admissão, sindicato e o estágio), cifrados no banco. Grava com a versão lida (outra pessoa que
// gravou antes vira "desatualizado"). Aberta também pela ficha do colaborador (`?aba=fichas&vinculo=N`).
import {
  type ApoioEsocial,
  esquemaRegistrarFichaEsocial,
  type FichaEsocialDoVinculo,
  type FichaEsocialVinculo,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { instanteBr } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerFichaEsocial, registrarFichaEsocial } from './api-esocial.js';
import BuscaColaboradorEsocial from './BuscaColaboradorEsocial.vue';
import { type ColaboradorEscolhido, fichaVazia, ouNulo } from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; vinculoInicial: number | null }>();
const { t } = useI18n();
const colaborador = ref<ColaboradorEscolhido | null>(
  props.vinculoInicial
    ? {
        vinculo: props.vinculoInicial,
        rotulo: t('folha.esocial.vinculo', { v: props.vinculoInicial }),
        tipo: null,
      }
    : null,
);
const lida = ref<FichaEsocialDoVinculo | null>(null);
const f = ref<FichaEsocialVinculo>(fichaVazia());
const estagio = ref(false);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const carregando = ref(false);
const ocupado = ref(false);
const tentou = ref(false);

async function abrir(v: number): Promise<void> {
  erro.value = null;
  aviso.value = null;
  tentou.value = false;
  lida.value = null;
  carregando.value = true;
  try {
    const r = await lerFichaEsocial(v);
    lida.value = r;
    f.value = r.ficha ? structuredClone({ ...r.ficha }) : fichaVazia();
    estagio.value = !!r.ficha?.estagio;
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}
watch(
  colaborador,
  (c) => {
    if (c) void abrir(c.vinculo);
    else lida.value = null;
  },
  { immediate: true },
);

const opc = (xs: readonly (number | string)[], base: string | null = null) =>
  xs.map((x) => ({ valor: x, rotulo: base ? t(`${base}.${x}`) : String(x) }));
const opcoesSexo = computed(() => opc(['M', 'F'], 'folha.esocial.ficha.sexos'));
const opcoesRaca = computed(() => opc([1, 2, 3, 4, 5, 6], 'folha.esocial.ficha.racas'));
const opcoesEstadoCivil = computed(() => [
  { valor: null, rotulo: t('folha.esocial.ficha.naoInformado') },
  ...opc([1, 2, 3, 4, 5], 'folha.esocial.ficha.estados'),
]);
const opcoesInstrucao = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => ({
  valor: x,
  rotulo: x,
}));
const opcoesCategoria = computed(() =>
  props.apoio.categorias.length
    ? props.apoio.categorias.map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} · ${c.rotulo}` }))
    : [{ valor: f.value.categoria, rotulo: f.value.categoria }],
);
const opcoesRegime = computed(() => opc([1, 2, 3, 4], 'folha.esocial.ficha.regimes'));
const opcoesNatureza = computed(() => opc([1, 2], 'folha.esocial.ficha.naturezas'));
const opcoesContrato = computed(() => opc([1, 2, 3], 'folha.esocial.ficha.contratos'));
const opcoesJornada = opc([2, 3, 4, 5, 6, 7, 9]);
const opcoesParcial = opc([0, 1, 2, 3]);
const opcoesTipoAdmissao = opc([1, 2, 3, 4, 5, 6, 7]);
const opcoesIndicativo = opc([1, 2, 3]);
const opcoesNaturezaEstagio = computed(() => opc(['O', 'N'], 'folha.esocial.ficha.naturezasEstagio'));
const opcoesNivel = [{ valor: null, rotulo: '—' }, ...opc([1, 2, 3, 4, 5, 6, 8, 9])];

// Campos opcionais em texto: o formulário guarda '' e a entrada leva null.
const texto = (v: string | null) => v ?? '';
const fichaParaEnvio = computed(() => {
  const x = f.value;
  const dig = (s: string | null) => (s ?? '').replace(/[.\-/\s]/g, '');
  return {
    ...x,
    nomeSocial: ouNulo(x.nomeSocial),
    endereco: {
      ...x.endereco,
      tipoLogradouro: ouNulo(x.endereco.tipoLogradouro),
      complemento: ouNulo(x.endereco.complemento),
      bairro: ouNulo(x.endereco.bairro),
      cep: dig(x.endereco.cep),
      uf: x.endereco.uf.trim().toUpperCase(),
    },
    cboCargo: ouNulo(dig(x.cboCargo)),
    cboFuncao: ouNulo(dig(x.cboFuncao)),
    // M53.8 (D-NIS-538): o NIS das obrigações anteriores ao eSocial (SEFIP, CAGED e RAIS); opcional.
    nis: ouNulo(dig(x.nis ?? null)),
    terminoContrato: x.tipoContrato === 2 || x.tipoContrato === 3 ? x.terminoContrato : null,
    cnpjSindicato: ouNulo(dig(x.cnpjSindicato))?.toUpperCase() ?? null,
    estagio: estagio.value
      ? {
          natureza: x.estagio?.natureza ?? 'O',
          nivel: x.estagio?.nivel ?? null,
          terminoPrevisto: x.estagio?.terminoPrevisto ?? '',
          cnpjInstituicao: dig(x.estagio?.cnpjInstituicao ?? '').toUpperCase(),
        }
      : null,
  };
});
const entrada = computed(() =>
  esquemaRegistrarFichaEsocial.safeParse({ ficha: fichaParaEnvio.value, versao: lida.value?.versao ?? null }),
);
const camposInvalidos = computed(() =>
  entrada.value.success
    ? ''
    : [...new Set(entrada.value.error.issues.map((i) => i.path.slice(1).join('.')))].join(', '),
);
function garantirEstagio(): void {
  if (!f.value.estagio)
    f.value = {
      ...f.value,
      estagio: { natureza: 'O', nivel: null, terminoPrevisto: '', cnpjInstituicao: '' },
    };
}
watch(estagio, (v) => {
  if (v) garantirEstagio();
});
async function gravar(): Promise<void> {
  tentou.value = true;
  if (!colaborador.value || !entrada.value.success) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarFichaEsocial(colaborador.value.vinculo, entrada.value.data);
    lida.value = r;
    if (r.ficha) f.value = structuredClone({ ...r.ficha });
    aviso.value = t('folha.esocial.ficha.gravada');
    tentou.value = false;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const opcoesSimNao = computed(() => [
  { valor: 'nao', rotulo: t('folha.esocial.parametros.nao') },
  { valor: 'sim', rotulo: t('folha.esocial.parametros.sim') },
]);
const temEstagio = computed<string>({
  get: () => (estagio.value ? 'sim' : 'nao'),
  set: (v) => {
    estagio.value = v === 'sim';
  },
});
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.ficha.titulo')" data-testid="esocial-ficha">
    <h2>{{ t('folha.esocial.ficha.titulo') }}</h2>
    <p class="secundario">{{ t('folha.esocial.ficha.ajuda') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="esocial-ficha-aviso" />
    <ErroFolha v-if="erro" :erro="erro" />
    <BuscaColaboradorEsocial v-model="colaborador" prefixo="esocial-ficha" />
    <p v-if="carregando" role="status">{{ t('folha.esocial.carregando') }}</p>
    <form v-else-if="colaborador && lida" data-testid="esocial-ficha-form" @submit.prevent="gravar">
      <p v-if="!lida.preenchida" class="secundario" data-testid="esocial-ficha-nova">
        {{ t('folha.esocial.ficha.naoPreenchida') }}
      </p>
      <p v-else-if="lida.alteradoPor" class="secundario" data-testid="esocial-ficha-alterada">
        {{
          t('folha.esocial.ficha.alterada', { por: lida.alteradoPor, em: instanteBr(lida.alteradoEm ?? '') })
        }}
      </p>
      <fieldset class="bloco">
        <legend>{{ t('folha.esocial.ficha.pessoais') }}</legend>
        <div class="campos">
          <SanteSelecao
            v-model="f.sexo"
            :rotulo="t('folha.esocial.ficha.sexo')"
            :opcoes="opcoesSexo"
            data-testid="esocial-ficha-sexo"
          />
          <SanteSelecao
            v-model="f.racaCor"
            :rotulo="t('folha.esocial.ficha.racaCor')"
            :opcoes="opcoesRaca"
            data-testid="esocial-ficha-raca"
          />
          <SanteSelecao
            v-model="f.estadoCivil"
            :rotulo="t('folha.esocial.ficha.estadoCivil')"
            :opcoes="opcoesEstadoCivil"
            data-testid="esocial-ficha-estado-civil"
          />
          <SanteSelecao
            v-model="f.grauInstrucao"
            :rotulo="t('folha.esocial.ficha.grauInstrucao')"
            :opcoes="opcoesInstrucao"
            data-testid="esocial-ficha-instrucao"
          />
          <SanteData
            :model-value="f.nascimento || null"
            :rotulo="t('folha.esocial.ficha.nascimento')"
            editavel
            data-testid="esocial-ficha-nascimento"
            @update:model-value="(v: string | null) => (f.nascimento = v ?? '')"
          />
        </div>
        <div class="campos">
          <SanteCampoTexto
            :model-value="texto(f.nomeSocial)"
            :rotulo="t('folha.esocial.ficha.nomeSocial')"
            :max-bytes="70"
            data-testid="esocial-ficha-nome-social"
            @update:model-value="(v: string) => (f.nomeSocial = v)"
          />
          <SanteCampoTexto
            v-model="f.paisNascimento"
            :rotulo="t('folha.esocial.ficha.paisNascimento')"
            :max-bytes="3"
            data-testid="esocial-ficha-pais-nascimento"
          />
          <SanteCampoTexto
            v-model="f.paisNacionalidade"
            :rotulo="t('folha.esocial.ficha.paisNacionalidade')"
            :max-bytes="3"
            data-testid="esocial-ficha-pais-nacionalidade"
          />
        </div>
      </fieldset>
      <fieldset class="bloco">
        <legend>{{ t('folha.esocial.ficha.endereco') }}</legend>
        <div class="campos">
          <SanteCampoTexto
            :model-value="texto(f.endereco.tipoLogradouro)"
            :rotulo="t('folha.esocial.ficha.tipoLogradouro')"
            :max-bytes="4"
            data-testid="esocial-ficha-tipo-logradouro"
            @update:model-value="(v: string) => (f.endereco.tipoLogradouro = v)"
          />
          <SanteCampoTexto
            v-model="f.endereco.logradouro"
            :rotulo="t('folha.esocial.ficha.logradouro')"
            :max-bytes="100"
            data-testid="esocial-ficha-logradouro"
          />
          <SanteCampoTexto
            v-model="f.endereco.numero"
            :rotulo="t('folha.esocial.ficha.numero')"
            :max-bytes="10"
            data-testid="esocial-ficha-numero"
          />
          <SanteCampoTexto
            :model-value="texto(f.endereco.complemento)"
            :rotulo="t('folha.esocial.ficha.complemento')"
            :max-bytes="30"
            data-testid="esocial-ficha-complemento"
            @update:model-value="(v: string) => (f.endereco.complemento = v)"
          />
          <SanteCampoTexto
            :model-value="texto(f.endereco.bairro)"
            :rotulo="t('folha.esocial.ficha.bairro')"
            :max-bytes="90"
            data-testid="esocial-ficha-bairro"
            @update:model-value="(v: string) => (f.endereco.bairro = v)"
          />
          <SanteCampoTexto
            v-model="f.endereco.cep"
            :rotulo="t('folha.esocial.ficha.cep')"
            :max-bytes="9"
            data-testid="esocial-ficha-cep"
          />
          <SanteCampoTexto
            v-model="f.endereco.municipio"
            :rotulo="t('folha.esocial.ficha.municipio')"
            :max-bytes="7"
            data-testid="esocial-ficha-municipio"
          />
          <SanteCampoTexto
            v-model="f.endereco.uf"
            :rotulo="t('folha.esocial.ficha.uf')"
            :max-bytes="2"
            data-testid="esocial-ficha-uf"
          />
        </div>
      </fieldset>
      <fieldset class="bloco">
        <legend>{{ t('folha.esocial.ficha.contrato') }}</legend>
        <div class="campos">
          <SanteSelecao
            v-model="f.categoria"
            :rotulo="t('folha.esocial.ficha.categoria')"
            :opcoes="opcoesCategoria"
            busca
            data-testid="esocial-ficha-categoria"
          />
          <SanteCampoTexto
            :model-value="texto(f.cboCargo)"
            :rotulo="t('folha.esocial.ficha.cboCargo')"
            :max-bytes="7"
            data-testid="esocial-ficha-cbo-cargo"
            @update:model-value="(v: string) => (f.cboCargo = v)"
          />
          <SanteCampoTexto
            :model-value="texto(f.cboFuncao)"
            :rotulo="t('folha.esocial.ficha.cboFuncao')"
            :max-bytes="7"
            data-testid="esocial-ficha-cbo-funcao"
            @update:model-value="(v: string) => (f.cboFuncao = v)"
          />
          <SanteCampoTexto
            :model-value="texto(f.nis ?? null)"
            :rotulo="t('folha.esocial.ficha.nis')"
            :max-bytes="14"
            data-testid="esocial-ficha-nis"
            @update:model-value="(v: string) => (f.nis = v)"
          />
          <SanteSelecao
            v-model="f.regimeJornada"
            :rotulo="t('folha.esocial.ficha.regimeJornada')"
            :opcoes="opcoesRegime"
            data-testid="esocial-ficha-regime"
          />
          <SanteSelecao
            v-model="f.naturezaAtividade"
            :rotulo="t('folha.esocial.ficha.naturezaAtividade')"
            :opcoes="opcoesNatureza"
            data-testid="esocial-ficha-natureza"
          />
        </div>
        <div class="campos">
          <SanteSelecao
            v-model="f.tipoContrato"
            :rotulo="t('folha.esocial.ficha.tipoContrato')"
            :opcoes="opcoesContrato"
            data-testid="esocial-ficha-tipo-contrato"
          />
          <SanteData
            v-if="f.tipoContrato !== 1"
            v-model="f.terminoContrato"
            :rotulo="t('folha.esocial.ficha.terminoContrato')"
            editavel
            data-testid="esocial-ficha-termino"
          />
          <SanteSelecao
            v-model="f.tipoJornada"
            :rotulo="t('folha.esocial.ficha.tipoJornada')"
            :opcoes="opcoesJornada"
            data-testid="esocial-ficha-tipo-jornada"
          />
          <SanteSelecao
            v-model="f.tempoParcial"
            :rotulo="t('folha.esocial.ficha.tempoParcial')"
            :opcoes="opcoesParcial"
            data-testid="esocial-ficha-parcial"
          />
          <SanteSelecao
            v-model="f.tipoAdmissao"
            :rotulo="t('folha.esocial.ficha.tipoAdmissao')"
            :opcoes="opcoesTipoAdmissao"
            data-testid="esocial-ficha-tipo-admissao"
          />
          <SanteSelecao
            v-model="f.indicativoAdmissao"
            :rotulo="t('folha.esocial.ficha.indicativoAdmissao')"
            :opcoes="opcoesIndicativo"
            data-testid="esocial-ficha-indicativo"
          />
        </div>
        <SanteCampoTexto
          v-model="f.descricaoJornada"
          :rotulo="t('folha.esocial.ficha.descricaoJornada')"
          :max-bytes="999"
          multilinha
          data-testid="esocial-ficha-descricao-jornada"
        />
        <SanteCampoTexto
          :model-value="texto(f.cnpjSindicato)"
          :rotulo="t('folha.esocial.ficha.cnpjSindicato')"
          :max-bytes="18"
          data-testid="esocial-ficha-sindicato"
          @update:model-value="(v: string) => (f.cnpjSindicato = v)"
        />
      </fieldset>
      <fieldset class="bloco">
        <legend>{{ t('folha.esocial.ficha.estagio') }}</legend>
        <SanteSelecao
          v-model="temEstagio"
          :rotulo="t('folha.esocial.ficha.estagio')"
          :opcoes="opcoesSimNao"
          data-testid="esocial-ficha-tem-estagio"
        />
        <div v-if="estagio && f.estagio" class="campos">
          <SanteSelecao
            v-model="f.estagio.natureza"
            :rotulo="t('folha.esocial.ficha.natureza')"
            :opcoes="opcoesNaturezaEstagio"
            data-testid="esocial-ficha-estagio-natureza"
          />
          <SanteSelecao
            v-model="f.estagio.nivel"
            :rotulo="t('folha.esocial.ficha.nivel')"
            :opcoes="opcoesNivel"
            data-testid="esocial-ficha-estagio-nivel"
          />
          <SanteData
            :model-value="f.estagio.terminoPrevisto || null"
            :rotulo="t('folha.esocial.ficha.terminoPrevisto')"
            editavel
            data-testid="esocial-ficha-estagio-termino"
            @update:model-value="(v: string | null) => f.estagio && (f.estagio.terminoPrevisto = v ?? '')"
          />
          <SanteCampoTexto
            v-model="f.estagio.cnpjInstituicao"
            :rotulo="t('folha.esocial.ficha.cnpjInstituicao')"
            :max-bytes="18"
            data-testid="esocial-ficha-estagio-cnpj"
          />
        </div>
      </fieldset>
      <p v-if="tentou && !entrada.success" role="alert" data-testid="esocial-ficha-invalida">
        {{ t('folha.esocial.ficha.invalida', { campos: camposInvalidos }) }}
      </p>
      <SanteBotao
        :rotulo="t('folha.esocial.gravar')"
        tipo="submit"
        :desabilitado="ocupado"
        data-testid="esocial-ficha-gravar"
      />
    </form>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
