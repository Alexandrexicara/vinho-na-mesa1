const fs = require('fs');

// Verificar se o banco de dados existe
if (!fs.existsSync('./vinho_na_mesa.db')) {
  console.log('Banco de dados não encontrado');
  process.exit(1);
}

console.log('Banco de dados encontrado. Para inspecionar a estrutura, seria necessário o módulo better-sqlite3.');
console.log('Como esse módulo requer compilação nativa e você teve problemas com ele anteriormente,');
console.log('vou sugerir uma alternativa mais simples.');

console.log('\nArquivos disponíveis no projeto:');
const files = fs.readdirSync('./public');
files.forEach(file => {
  console.log('- ' + file);
});

console.log('\nPara criar um acesso administrativo, você pode:');
console.log('1. Criar um novo arquivo admin com credenciais fixas');
console.log('2. Usar um sistema de autenticação simples baseado em sessão');
console.log('3. Implementar um formulário de login no admin.html');