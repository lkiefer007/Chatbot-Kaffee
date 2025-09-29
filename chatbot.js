// CONFIGURAÇÃO INICIAL
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const moment = require('moment');
require('dotenv').config();
const credentials = require('./credentials.json');

// GEMINI (mantido)
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function chamarGemini(pergunta) {
  try {
    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: pergunta }] }]
    });

    if (response?.response?.candidates?.length > 0) {
      const textoResposta = response.response.candidates[0].content.parts[0].text;
      return textoResposta || "🤖 Não consegui entender sua pergunta, tente de outra forma.";
    } else {
      return "🤖 Estou com dificuldades para responder no momento.";
    }
  } catch (err) {
    console.error("Erro ao chamar Gemini:", err);
    return "🤖 Ocorreu um erro ao processar sua mensagem, tente novamente em instantes.";
  }
}

// PLANILHA
const SPREADSHEET_ID = '1B4mLr9qyRna8FheWAtMbfDgidcHnB6W7ati3SHJuXiI';
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

// --- FERIADOS ---
const FERIADOS = [
  '01/01','21/04','01/05','07/09','12/10','02/11','15/11','25/12'
];

// HORÁRIOS
const HORA_INICIO = "07:30";
const HORA_FIM = "16:30";
const ALMOCO_INICIO = "11:00";
const ALMOCO_FIM = "12:00";

// CONTATOS
const contatos = {
  cotacao: 'José Fernandes - (27) 99978-5768',
  compra: 'Diogo - (27) 99858-1383',
  financeiro: 'Angelita - (27) 99747-4410',
  rh: 'RH - (27) 99784-1052',
  qualidade: 'Gean - (27) 98108-1371'
};

// CLIENTE WHATSAPP
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: puppeteer.executablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// QR CODE
client.on('qr', qr => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
  console.log('🤖 Bot pronto!');
  await iniciarPlanilha();
});

async function iniciarPlanilha() {
  await doc.useServiceAccountAuth({
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, '\n')
  });
  await doc.loadInfo();

  // Garantir que a aba "Agenda" exista e possua cabeçalho com as colunas esperadas,
  // incluindo 'MOTIVO' na posição M (13ª coluna).
  const agendaSheet = doc.sheetsByTitle['Agenda'];
  if (!agendaSheet) {
    // cria uma nova folha Agenda com cabeçalho padrão
    const headers = ['CONFIRMAÇÃO','ORDEM','DATA','HORA','VENDEDOR','DESCRIÇÃO','TIPO','CORRETOR','TELEFONE','NOME','QUANTIDADE','EMBALAGEM','MOTIVO'];
    await doc.addSheet({ title: 'Agenda', headerValues: headers });
  } else {
    await agendaSheet.loadHeaderRow();
    const desiredHeaders = ['CONFIRMAÇÃO','ORDEM','DATA','HORA','VENDEDOR','DESCRIÇÃO','TIPO','CORRETOR','TELEFONE','NOME','QUANTIDADE','EMBALAGEM','MOTIVO'];
    const current = agendaSheet.headerValues || [];
    // se algum cabeçalho ausente ou posição diferente, ajusta para lista desejada
    let needsSet = false;
    for (let i = 0; i < desiredHeaders.length; i++) {
      if (current[i] !== desiredHeaders[i]) {
        needsSet = true;
        break;
      }
    }
    if (needsSet) {
      await agendaSheet.setHeaderRow(desiredHeaders);
    }
  }
}

// --- FUNÇÕES AUXILIARES ---
function formatarTelefone(raw) {
  const tel = raw.replace(/\D/g,'').slice(-11);
  if (tel.length < 11) return raw;
  return `(${tel.slice(0,2)}) ${tel.slice(2,7)}-${tel.slice(7)}`;
}

function menuPrincipal(nome) {
  return `👋 Olá ${nome}, seja bem-vindo à *Kaffee Exp. e Imp. Ltda*\n\nEscolha uma opção:\n\n`+
    `1️⃣ Agendamento de descarga\n`+
    `2️⃣ Cotação do café\n`+
    `3️⃣ Comercial\n`+
    `4️⃣ Financeiro\n`+
    `5️⃣ RH\n`+
    `6️⃣ Setor de Qualidade\n`+
    `7️⃣ Falar com atendente\n`+
    `8️⃣ Voltar ao menu\n`+
    `9️⃣ Agendar Manutenção (apenas para Administradores)\n\nDigite o número correspondente.`;
}

// --- GERA DATAS (sem sábado/domingo/feriado) ---
function gerarDatasValidas() {
  const agora = moment();
  let base = agora;
  if (agora.hour() >= 16 && agora.minute() >= 30) base = agora.add(1, 'days');

  const dias = [];
  let contador = 0;

  while (dias.length < 7 && contador < 15) {
    const data = base.clone().add(contador, 'days');
    const formato = data.format('DD/MM/YYYY');
    const ehFimDeSemana = [6,0].includes(data.day());
    const ehFeriado = FERIADOS.includes(data.format('DD/MM'));

    if (!ehFimDeSemana && !ehFeriado) {
      dias.push(formato);
    }
    contador++;
  }
  return dias;
}

// --- CALCULA DURAÇÃO BASEADA NA QUANTIDADE ---
function tempoDescarga(qtdSacas) {
  if (qtdSacas <= 250) return 45;
  if (qtdSacas <= 500) return 60;
  return 120;
}

// --- BUSCA HORÁRIOS INDISPONÍVEIS (Agenda: DATA & HORA) ---
async function getHorariosIndisponiveisParaData(data, doc) {
  const agendaSheet = doc.sheetsByTitle['Agenda'];
  const rows = (await agendaSheet.getRows()) || [];
  // data esperado em 'DD/MM/YYYY'
  return rows
    .filter(r => String((r['DATA']||'')).trim() === String((data||'')).trim())
    .map(r => String(r['HORA']||'').trim())
    .filter(x => x); // remove vazios
}

// --- GERA HORÁRIOS DINÂMICOS (considera ocupados e bloqueios) ---
async function gerarHorariosDisponiveis(data, doc, qtdSacas) {
  const ocupadosArr = await getHorariosIndisponiveisParaData(data, doc);
  const ocupadosSet = new Set(ocupadosArr);

  let horarios = [];
  let horaAtual = moment(HORA_INICIO, "HH:mm");

  while (horaAtual.isSameOrBefore(moment(HORA_FIM, "HH:mm"))) {
    if (horaAtual.isBetween(moment(ALMOCO_INICIO,"HH:mm"), moment(ALMOCO_FIM,"HH:mm"), null, '[)')) {
      horaAtual = moment(ALMOCO_FIM,"HH:mm");
      continue;
    }

    const horaStr = horaAtual.format("HH:mm");

    // Se horário já ocupado (ou bloqueado) pula
    if (!ocupadosSet.has(horaStr)) {
      // verificar se a descarga para após almoço (caso especial)
      const inicio = horaAtual.clone();
      const fimPrevisto = inicio.clone().add(tempoDescarga(qtdSacas), "minutes");
      if (!(inicio.isBefore(moment(ALMOCO_INICIO,"HH:mm")) && fimPrevisto.isAfter(moment(ALMOCO_INICIO,"HH:mm")))) {
        horarios.push(horaStr);
      }
    }

    // avancar pelo tempo padrão (para construir slots)
    horaAtual.add(45, "minutes");
  }

  // filtrar horários compatíveis com a quantidade do usuário (fim <= HORA_FIM)
  return horarios.filter(hora=>{
    const inicio = moment(hora,"HH:mm");
    const fim = inicio.clone().add(tempoDescarga(qtdSacas),"minutes");
    return fim.isSameOrBefore(moment(HORA_FIM,"HH:mm"));
  });
}

// --- CONTROLE DE ESTADOS POR USUÁRIO ---
const estados = {};

// --- FUNÇÃO: Adicionar agendamento normal (mantendo CONFIRMAÇÃO da aba Registros) ---
async function adicionarAgendamentoNoTopo({ ordem, data, hora, registro, telefone, nome, qtd, embalagem }) {
  const agendaSheet = doc.sheetsByTitle['Agenda'];
  const registrosSheet = doc.sheetsByTitle['Registros'];

  // Pegar CONFIRMAÇÃO da aba Registros (coluna B)
  await registrosSheet.loadCells(); // garante cache
  const rowsReg = await registrosSheet.getRows();
  const encontrado = rowsReg.find(r => String(r['ORDEM']).trim() === String(ordem).trim());
  const confirmacao = encontrado ? (encontrado['CONFIRMAÇÃO'] || '') : '';

  // montar nova linha com a ordem de colunas do header (addRow com objeto usa header names)
  const novaLinha = {
    'CONFIRMAÇÃO': confirmacao || '',
    'ORDEM': ordem || '',
    'DATA': data || '',
    'HORA': hora || '',
    'VENDEDOR': registro['VENDEDOR']||'',
    'DESCRIÇÃO': registro['DESCRIÇÃO']||'',
    'TIPO': registro['TIPO']||'',
    'CORRETOR': registro['CORRETOR']||'',
    'TELEFONE': telefone || '',
    'NOME': nome || '',
    'QUANTIDADE': qtd || '',
    'EMBALAGEM': embalagem || '',
    'MOTIVO': ''
  };

  // Insere no topo (insert:true) após o header
  await agendaSheet.addRow(novaLinha, { raw: true, insert: true });
}

// --- FUNÇÃO: Registrar bloqueio(s) na Agenda (cada horário uma linha) ---
async function registrarBloqueiosNaAgenda({ data, horarios, motivo, nomeAdmin, telefoneAdmin }) {
  const agendaSheet = doc.sheetsByTitle['Agenda'];

  // Construir e inserir cada linha no topo
  for (const hora of horarios) {
    const novaLinha = {
      'CONFIRMAÇÃO': '',
      'ORDEM': '',
      'DATA': data,
      'HORA': hora,
      'VENDEDOR': '',
      'DESCRIÇÃO': '',
      'TIPO': '',
      'CORRETOR': '',
      'TELEFONE': telefoneAdmin || '',
      'NOME': nomeAdmin || '',
      'QUANTIDADE': '',
      'EMBALAGEM': '',
      'MOTIVO': motivo || ''
    };
    await agendaSheet.addRow(novaLinha, { raw: true, insert: true });
  }
}

// --- FLUXO DE MENSAGENS ---
client.on('message', async msg=>{
  try {
    const textoBruto = msg.body || '';
    const texto = textoBruto.toLowerCase().trim();
    const nome = msg._data?.notifyName || 'usuário';
    const telefone = formatarTelefone(msg.from);
    const from = msg.from;

    if (!estados[from]) estados[from] = { etapa: null };

    // Gatilhos para menu (reseta estado e mostra menu)
    const gatilhos = ['oi','olá','bom','boa','dia','noite','agendar','agenda','descarga','menu','chat'];
    if (gatilhos.some(p=>texto.includes(p))) {
      estados[from].etapa = null;
      return msg.reply(menuPrincipal(nome));
    }

    // fluxo principal - prioriza estado; se não houver, interpreta texto direto
    const etapaAtual = estados[from].etapa || texto;

    switch(etapaAtual){
      case '1': { // Agendamento normal
        estados[from].etapa = 'ordem';
        return msg.reply('📦 Por favor, envie o número da *ORDEM* de compra.');
      }

      // --- AGENDAMENTO NORMAL (seu fluxo existente, levemente ajustado) ---
      case 'ordem': {
        const numero = msg.body.trim();
        const sheet = doc.sheetsByTitle['Registros'];
        const rows = await sheet.getRows();
        const registro = rows.find(r=>String(r['ORDEM']).trim()===numero);

        if (!registro) {
          return msg.reply('❌ ORDEM não encontrada.');
        }

        // Verifica se já foi agendado
        const agendaSheet = doc.sheetsByTitle['Agenda'];
        const jaAgendado = (await agendaSheet.getRows())
          .find(r=>String(r['ORDEM']).trim()===numero);

        if (jaAgendado) {
          estados[from].etapa = null;
          return msg.reply("!Esta ORDEM de descarga já foi agendada, não é permitido agendar novamente. Entre em contato caso deseje mudar a data ou horário.");
        }

        estados[from].ordem = numero;
        estados[from].registro = registro;

        const dias = gerarDatasValidas();
        const opcoesDatas = dias.map((d,i)=>`${i+1}️⃣ ${d}`).join('\n');
        estados[from].etapa = 'data';
        return msg.reply(`📋 Escolha a data do agendamento:\n\n${opcoesDatas}`);
      }

      case 'data': {
        const dias = gerarDatasValidas();
        const indiceData = parseInt(texto)-1;
        const dataEscolhida = dias[indiceData];
        if (!dataEscolhida) {
          estados[from].etapa = null;
          return msg.reply('❌ Opção inválida. Agendamento cancelado.');
        }

        estados[from].data = dataEscolhida; // formato DD/MM/YYYY
        estados[from].etapa = 'embalagem';
        return msg.reply("📦 Qual a forma de descarga?\n\n1️⃣ Granel\n2️⃣ Sacaria\n3️⃣ Bags");
      }

      case 'embalagem': {
        let embalagem = '';
        if (texto==='1') embalagem='Granel';
        else if (texto==='2') embalagem='Sacaria';
        else if (texto==='3') embalagem='Bags';
        else return msg.reply("❌ Opção inválida. Digite 1, 2 ou 3.");

        estados[from].embalagem = embalagem;
        estados[from].etapa = 'quantidade';
        return msg.reply("📊 Informe a quantidade total de sacas:");
      }

      case 'quantidade': {
        const qtdSacas = parseInt(msg.body.trim());
        if (isNaN(qtdSacas) || qtdSacas<=0) {
          return msg.reply("❌ Quantidade inválida. Digite apenas números.");
        }

        estados[from].qtd = qtdSacas;
        estados[from].etapa = 'periodo';
        return msg.reply("🌞 Escolha o período:\n\n1️⃣ Manhã\n2️⃣ Tarde");
      }

      case 'periodo': {
        let periodo = '';
        if (texto==='1') periodo='manhã';
        else if (texto==='2') periodo='tarde';
        else return msg.reply("❌ Opção inválida. Digite 1 ou 2.");

        estados[from].periodo = periodo;

        const horariosDisponiveis = await gerarHorariosDisponiveis(estados[from].data, doc, estados[from].qtd);
        let filtrados = horariosDisponiveis;

        if (periodo==='manhã') {
          filtrados = horariosDisponiveis.filter(h=>moment(h,'HH:mm').isBefore(moment(ALMOCO_INICIO,'HH:mm')));
        } else {
          filtrados = horariosDisponiveis.filter(h=>moment(h,'HH:mm').isSameOrAfter(moment(ALMOCO_FIM,'HH:mm')));
        }

        if (filtrados.length===0) {
          estados[from].etapa = null;
          return msg.reply("⚠️ Nenhum horário disponível nesse período.");
        }

        const opcoes = filtrados.map((h,i)=>`${i+1}️⃣ ${h}`).join('\n');
        estados[from].horarios = filtrados;
        estados[from].etapa = 'hora';
        return msg.reply(`⏰ Escolha o horário desejado:\n\n${opcoes}`);
      }

      case 'hora': {
        const indiceHora = parseInt(texto)-1;
        const horaEscolhida = estados[from].horarios[indiceHora];
        if (!horaEscolhida) {
          estados[from].etapa = null;
          return msg.reply("❌ Opção inválida. Agendamento cancelado.");
        }

        await adicionarAgendamentoNoTopo({
          ordem: estados[from].ordem,
          data: estados[from].data,
          hora: horaEscolhida,
          registro: estados[from].registro,
          telefone,
          nome,
          qtd: estados[from].qtd,
          embalagem: estados[from].embalagem
        });

        msg.reply(
          `✅ Agendamento realizado com sucesso!\n\n📄 *Resumo:*\n`+
          `• Ordem: ${estados[from].ordem}\n`+
          `• Data: ${estados[from].data}\n`+
          `• Horário: ${horaEscolhida}\n`+
          `• Quantidade: ${estados[from].qtd} sacas\n`+
          `• Embalagem: ${estados[from].embalagem}\n`+
          `• Vendedor: ${estados[from].registro['VENDEDOR'] || 'Não informado'}`
        );

        estados[from] = { etapa:null };
        break;
      }

      // --- NOVA OPÇÃO 9: AGENDAR MANUTENÇÃO (ADMIN) ---
      case '9': {
        estados[from].etapa = 'adminSenha';
        return msg.reply('🔐 Digite a senha de administrador:');
      }

      case 'adminSenha': {
        // ler senha em Dados!E1
        const dadosSheet = doc.sheetsByTitle['Dados'];
        if (!dadosSheet) {
          estados[from].etapa = null;
          return msg.reply('❌ Aba "Dados" não encontrada na planilha. Contate o administrador.');
        }
        await dadosSheet.loadCells('E1');
        const cell = dadosSheet.getCell(0,4); // E1 => row 0 col 4
        const senhaCorreta = (cell.value || '').toString().trim();

        if (textoBruto.trim() === senhaCorreta && senhaCorreta !== '') {
          estados[from].etapa = 'adminData';
          return msg.reply('✅ Senha correta.\n\n📅 Digite a data do bloqueio (formato DD/MM/YYYY):');
        } else {
          estados[from].etapa = null;
          return msg.reply('❌ Senha incorreta. Voltando ao menu principal.');
        }
      }

      case 'adminData': {
        // valida data DD/MM/YYYY
        if (!moment(textoBruto, "DD/MM/YYYY", true).isValid()) {
          return msg.reply("⚠️ Data inválida! Use o formato DD/MM/YYYY.");
        }
        estados[from].adminData = moment(textoBruto, "DD/MM/YYYY").format('DD/MM/YYYY');
        // Gerar horários disponíveis para a data (usamos qtd padrão 250 para slots de 45min)
        const horariosDisponiveis = await gerarHorariosDisponiveis(estados[from].adminData, doc, 250);
        if (!horariosDisponiveis || horariosDisponiveis.length === 0) {
          estados[from].etapa = null;
          return msg.reply('⚠️ Não há horários disponíveis para bloqueio nesta data.');
        }
        const opcoes = horariosDisponiveis.map((h,i)=>`${i+1}️⃣ ${h}`).join('\n');
        estados[from].adminHorariosList = horariosDisponiveis;
        estados[from].etapa = 'adminEscolherHorarios';
        return msg.reply(`⏰ Escolha os horários a bloquear. Você pode selecionar múltiplos escrevendo os números separados por vírgula.\n\n${opcoes}\n\nExemplo: 1,2,3`);
      }

      case 'adminEscolherHorarios': {
        // textoBruto com índices separados por vírgula
        const parts = textoBruto.split(',').map(p=>p.trim()).filter(p=>p);
        const indices = [];
        for (const p of parts) {
          const n = parseInt(p);
          if (!isNaN(n) && n >= 1 && n <= (estados[from].adminHorariosList||[]).length) {
            indices.push(n-1);
          }
        }
        if (indices.length === 0) {
          estados[from].etapa = null;
          return msg.reply('❌ Nenhuma opção válida selecionada. Operação cancelada.');
        }
        const selecionados = [...new Set(indices)].map(i => estados[from].adminHorariosList[i]);
        estados[from].adminHorariosSelecionados = selecionados;
        estados[from].etapa = 'adminMotivo';
        return msg.reply('✏️ Agora digite o motivo do bloqueio (texto livre):');
      }

      case 'adminMotivo': {
        const motivo = textoBruto.trim();
        if (!motivo) {
          return msg.reply('❌ Motivo não pode ser vazio. Digite o motivo do bloqueio:');
        }
        const data = estados[from].adminData;
        const horarios = estados[from].adminHorariosSelecionados || [];
        const nomeAdmin = msg._data?.notifyName || 'Administrador';
        const telefoneAdmin = telefone;

        await registrarBloqueiosNaAgenda({ data, horarios, motivo, nomeAdmin, telefoneAdmin });

        // resetar estado
        estados[from] = { etapa: null };

        return msg.reply(
          `✅ Bloqueio(s) registrado(s) com sucesso!\n\n` +
          `📅 Data: ${data}\n` +
          `⏰ Horários: ${horarios.join(', ')}\n` +
          `📝 Motivo: ${motivo}`
        );
      }

      // outros menus (2..8)
      case '2': msg.reply(`📞 Contato: ${contatos.cotacao}`); break;
      case '3': msg.reply(`📞 Contato: ${contatos.compra}`); break;
      case '4': msg.reply(`📞 Contato: ${contatos.financeiro}`); break;
      case '5': msg.reply(`📞 Contato: ${contatos.rh}`); break;
      case '6': msg.reply(`📞 Contato: ${contatos.qualidade}`); break;
      case '7': msg.reply('👤 Encaminhando para atendente...'); break;
      case '8': msg.reply(menuPrincipal(nome)); break;

      default: {
        // Se não for nenhum fluxo conhecido, delega para Gemini
        const respostaIA = await chamarGemini(textoBruto);
        msg.reply(respostaIA);
      }
    }
  } catch (err) {
    console.error('Erro no fluxo de mensagens:', err);
    try { msg.reply('❌ Ocorreu um erro interno. Tente novamente mais tarde.'); } catch(e){}
  }
});

client.initialize();
